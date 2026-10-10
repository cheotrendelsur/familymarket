import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { auth, db, rpc } from '../lib/api'
import { store } from '../lib/storage'
import { usePolling } from '../hooks/usePolling'

const AuthContext = createContext(null)

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const RATE_LIMIT = /rate limit|too many|over_request_rate_limit/i

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(null)
  const [tourLocal, setTourLocal] = useState(false) // respaldo si el servidor no alcanzó a guardar «tutorial visto»
  const [tourReplay, setTourReplay] = useState(false)
  const userIdRef = useRef(null)

  // Carga el perfil (con reintentos: justo después del registro el trigger
  // que crea la fila puede tardar unos milisegundos).
  const loadProfile = useCallback(async (userId, { silent = false } = {}) => {
    if (!silent) setProfileError(null)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { data, error } = await db.profile(userId)
      if (userIdRef.current !== userId) return null // cambió de usuario mientras cargaba
      if (!error && data) {
        setProfile((prev) => {
          const next = { ...data, balance: Number(data.balance) }
          // Evita renderizar toda la app si nada cambió.
          if (
            prev &&
            prev.id === next.id &&
            prev.balance === next.balance &&
            prev.username === next.username &&
            prev.is_admin === next.is_admin &&
            prev.is_moderator === next.is_moderator &&
            prev.tour_completed_at === next.tour_completed_at
          ) {
            return prev
          }
          return next
        })
        setProfileError(null)
        return data
      }
      if (silent) return null
      if (attempt < 3) await sleep(500 * (attempt + 1))
      else setProfileError(error?.message || 'No se encontró tu perfil')
    }
    return null
  }, [])

  useEffect(() => {
    let active = true

    auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return
      const sessionUser = session?.user ?? null
      userIdRef.current = sessionUser?.id ?? null
      setUser(sessionUser)
      if (sessionUser) await loadProfile(sessionUser.id)
      if (active) setLoading(false)
    })

    const unsubscribe = auth.onChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return
      const sessionUser = session?.user ?? null
      const changed = (sessionUser?.id ?? null) !== userIdRef.current
      userIdRef.current = sessionUser?.id ?? null
      setUser(sessionUser)
      if (!sessionUser) {
        setProfile(null)
        setProfileError(null)
        setLoading(false)
      } else if (changed) {
        // Diferido: llamar a supabase dentro de este callback puede bloquear el cliente.
        setTimeout(async () => {
          await loadProfile(sessionUser.id)
          if (active) setLoading(false)
        }, 0)
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [loadProfile])

  useEffect(() => {
    setTourLocal(user?.id ? !!store.get(`fm_tour_${user.id}`, false) : false)
    setTourReplay(false)
  }, [user?.id])

  /** Marca el tutorial como visto (en el servidor, para que valga en todos sus dispositivos). */
  const completeTour = useCallback(async () => {
    const id = userIdRef.current
    try {
      await rpc('complete_tour')
    } catch {
      /* sin conexión: se recuerda en este dispositivo y se reintenta al volver */
    }
    if (id) store.set(`fm_tour_${id}`, true)
    setTourLocal(true)
    setProfile((prev) => (prev ? { ...prev, tour_completed_at: prev.tour_completed_at || new Date().toISOString() } : prev))
  }, [])

  const signUp = useCallback((email, password, data) => auth.signUp(email, password, data), [])

  /**
   * Inicia sesión. Si el servidor pide esperar (muchos jugadores entrando a la vez
   * desde la misma red), reintenta solo unas veces avisando con `onWait(intento, total)`.
   */
  const signIn = useCallback(async (email, password, { onWait, attempts = 4 } = {}) => {
    let result
    for (let i = 1; i <= attempts; i += 1) {
      result = await auth.signIn(email, password)
      if (!result.error || !RATE_LIMIT.test(result.error.message || '')) return result
      if (i < attempts) {
        onWait?.(i, attempts - 1)
        await sleep(1800 * i + Math.random() * 1500)
      }
    }
    return result
  }, [])

  const signInWithGoogle = useCallback(() => auth.signInWithGoogle(), [])
  const signOut = useCallback(() => auth.signOut(), [])

  const refreshProfile = useCallback(() => {
    if (userIdRef.current) return loadProfile(userIdRef.current, { silent: true })
    return Promise.resolve(null)
  }, [loadProfile])

  // El dueño puede cambiar roles/saldos en cualquier momento: se mantiene al día sin recargar.
  usePolling(refreshProfile, { interval: 60000, enabled: !!user && !!profile?.username })

  const retryProfile = useCallback(async () => {
    if (!userIdRef.current) return
    setLoading(true)
    await loadProfile(userIdRef.current)
    setLoading(false)
  }, [loadProfile])

  // Actualiza el saldo al instante con el valor que devuelve el servidor (sin otra petición).
  const applyBalance = useCallback((balance) => {
    if (balance === undefined || balance === null) return
    setProfile((prev) => (prev ? { ...prev, balance: Number(balance) } : prev))
  }, [])

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      profileError,
      needsUsername: !!profile && !profile.username,
      // El dueño no necesita tutorial (puede repetirlo desde Portafolio si quiere).
      needsTour: !!profile && !!profile.username && !profile.is_admin && !profile.tour_completed_at && !tourLocal,
      completeTour,
      tourReplay,
      startTourReplay: () => setTourReplay(true),
      stopTourReplay: () => setTourReplay(false),
      isOwner: !!profile?.is_admin,
      isModerator: !!profile?.is_moderator,
      isStaff: !!profile?.is_admin || !!profile?.is_moderator,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      refreshProfile,
      retryProfile,
      applyBalance,
    }),
    [user, profile, loading, profileError, tourLocal, tourReplay, completeTour, signUp, signIn, signInWithGoogle, signOut, refreshProfile, retryProfile, applyBalance]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
