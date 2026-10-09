import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'

const AuthContext = createContext(null)

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}

const PROFILE_COLUMNS = 'id, username, balance, is_admin, email'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
      const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle()
      if (userIdRef.current !== userId) return null // cambió de usuario mientras cargaba
      if (!error && data) {
        setProfile({ ...data, balance: Number(data.balance) })
        setProfileError(null)
        return data
      }
      if (attempt < 3) await sleep(500 * (attempt + 1))
      else if (!silent) setProfileError(error?.message || 'No se encontró tu perfil')
    }
    return null
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return
      const sessionUser = session?.user ?? null
      userIdRef.current = sessionUser?.id ?? null
      setUser(sessionUser)
      if (sessionUser) await loadProfile(sessionUser.id)
      if (active) setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
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
      subscription.unsubscribe()
    }
  }, [loadProfile])

  const signUp = useCallback((email, password) => supabase.auth.signUp({ email, password }), [])
  const signIn = useCallback((email, password) => supabase.auth.signInWithPassword({ email, password }), [])
  const signOut = useCallback(() => supabase.auth.signOut(), [])

  const refreshProfile = useCallback(() => {
    if (userIdRef.current) return loadProfile(userIdRef.current, { silent: true })
    return Promise.resolve(null)
  }, [loadProfile])

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
