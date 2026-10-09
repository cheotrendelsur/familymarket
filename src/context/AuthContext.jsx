import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { auth, db } from '../lib/api'
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
            prev.is_moderator === next.is_moderator
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

  const signUp = useCallback((email, password) => auth.signUp(email, password), [])

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
      isOwner: !!profile?.is_admin,
      isModerator: !!profile?.is_moderator,
      isStaff: !!profile?.is_admin || !!profile?.is_moderator,
      signUp,
      signIn,
      signOut,
      refreshProfile,
      retryProfile,
      applyBalance,
    }),
    [user, profile, loading, profileError, signUp, signIn, signOut, refreshProfile, retryProfile, applyBalance]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
