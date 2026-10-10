import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, ChevronDown, Eye, EyeOff, Loader } from 'lucide-react'
import { auth } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useConfirm } from '../components/ConfirmDialog'
import { copyText, inAppBrowser } from '../lib/browser'
import { friendlyAuthError } from '../lib/format'

const inputClass =
  'w-full px-4 py-3 rounded-lg border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition'

function GoogleLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

/** Errores que Supabase deja en la dirección cuando falla el regreso desde Google (?error=...&error_description=...). */
function readOAuthError() {
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    const raw = hash.get('error_description') || query.get('error_description') || hash.get('error') || query.get('error')
    if (!raw) return null
    return friendlyAuthError({ message: raw.replace(/\+/g, ' ') })
  } catch {
    return null
  }
}

export default function AuthPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, signIn, signUp, signInWithGoogle } = useAuth()
  const confirm = useConfirm()
  const [googleOn, setGoogleOn] = useState(null) // null = comprobando
  const [showForm, setShowForm] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [error, setError] = useState(() => readOAuthError())
  const [success, setSuccess] = useState(null)
  const [waiting, setWaiting] = useState(null)
  const [copied, setCopied] = useState(false)
  const embedded = inAppBrowser()

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  useEffect(() => {
    let active = true
    auth.googleEnabled().then((on) => active && setGoogleOn(on))
    return () => {
      active = false
    }
  }, [])

  // Limpia ?error=... de la dirección para que no reaparezca al recargar.
  useEffect(() => {
    if (error && (location.search || location.hash)) navigate('/auth', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const formVisible = googleOn === false || showForm

  const handleGoogle = async () => {
    if (googleBusy) return
    setError(null)
    setGoogleBusy(true)
    try {
      const { error: oauthError } = await signInWithGoogle()
      if (oauthError) throw oauthError
      // Si todo va bien el navegador ya se está yendo a Google; en modo demo entra de una vez.
    } catch (err) {
      setError(friendlyAuthError(err))
      setGoogleBusy(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (loading) return
    const cleanEmail = email.trim().toLowerCase()

    if (isSignUp) {
      const ok = await confirm({
        title: 'Crear cuenta nueva',
        message: `¿Es correcto este correo?\n${cleanEmail}`,
        confirmText: 'Sí, crear cuenta',
      })
      if (!ok) return
    }

    setError(null)
    setSuccess(null)
    setWaiting(null)
    setLoading(true)
    try {
      if (isSignUp) {
        const { data, error: signUpError } = await signUp(cleanEmail, password)
        if (signUpError) throw signUpError
        if (data.session) {
          navigate('/', { replace: true })
        } else {
          setSuccess('¡Cuenta creada! Revisa tu correo para confirmarla y luego inicia sesión.')
          setPassword('')
          setIsSignUp(false)
        }
      } else {
        const { error: signInError } = await signIn(cleanEmail, password, {
          // Muchos jugadores entrando a la vez: se reintenta solo, sin que tengas que hacer nada.
          onWait: (attempt, total) => setWaiting(`Hay mucha gente entrando a la vez… reintentando solo (${attempt}/${total})`),
        })
        if (signInError) throw signInError
        navigate('/', { replace: true })
      }
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setLoading(false)
      setWaiting(null)
    }
  }

  const copyLink = async () => {
    if (await copyText(window.location.origin)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  return (
    <div className="min-h-screen bg-polygray-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-gradient-to-br from-polyblue to-blue-600 rounded-2xl p-8 mb-6 text-center shadow-xl">
          <div className="w-20 h-20 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
            <span className="text-4xl font-bold text-white">FM</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">FamilyMarket</h1>
          <p className="text-blue-100 text-sm">Mercado de predicciones familiar</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            {googleOn && !formVisible ? 'Entrar' : isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}
          </h2>

          {embedded && (
            <div className="mb-5 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900" role="status">
              <p className="font-bold mb-1">Ábrelo en tu navegador 🌐</p>
              <p>
                Estás dentro de otra app y Google no deja iniciar sesión aquí. Toca los tres puntos (⋯) y elige «Abrir en Safari» o «Abrir en Chrome», o copia el
                enlace y pégalo en tu navegador.
              </p>
              <button type="button" onClick={copyLink} className="mt-2 font-bold text-amber-800 underline">
                {copied ? '¡Enlace copiado!' : 'Copiar enlace'}
              </button>
            </div>
          )}

          {error && (
            <div className="mb-5 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3" role="alert">
              <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-sm flex-1">{error}</p>
            </div>
          )}

          {googleOn === null && (
            <div className="flex justify-center py-6" role="status" aria-label="Cargando">
              <Loader size={26} className="animate-spin text-polyblue" />
            </div>
          )}

          {googleOn && (
            <>
              <button
                type="button"
                onClick={handleGoogle}
                disabled={googleBusy}
                className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-300 text-gray-800 py-3.5 rounded-xl font-bold text-lg hover:bg-gray-50 active:scale-[0.99] transition disabled:opacity-60 shadow-sm"
              >
                {googleBusy ? <Loader size={20} className="animate-spin" /> : <GoogleLogo />}
                Continuar con Google
              </button>
              <p className="text-xs text-gray-500 text-center mt-3">Elige la cuenta de Google que le diste a Cheche. Sin contraseñas ni correos.</p>
              {!formVisible && (
                <button type="button" onClick={() => setShowForm(true)} className="mt-5 w-full flex items-center justify-center gap-1 text-sm font-semibold text-gray-500 hover:text-gray-700">
                  Usar correo y contraseña <ChevronDown size={16} />
                </button>
              )}
            </>
          )}

          {formVisible && (
            <>
              {googleOn && <div className="my-5 flex items-center gap-3 text-xs text-gray-400 font-semibold uppercase tracking-wider"><span className="flex-1 h-px bg-gray-200" />o<span className="flex-1 h-px bg-gray-200" /></div>}
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-2">
                    Correo electrónico
                  </label>
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    required
                    className={inputClass}
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-2">
                    Contraseña
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={isSignUp ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className={`${inputClass} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-500"
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                  {isSignUp && <p className="text-xs text-gray-500 mt-1.5">Mínimo 6 caracteres</p>}
                </div>

                {waiting && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center gap-3" role="status">
                    <Loader size={18} className="animate-spin text-amber-600 flex-shrink-0" />
                    <p className="text-amber-900 text-sm">{waiting}</p>
                  </div>
                )}

                {success && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-green-700 text-sm">{success}</p>
                  </div>
                )}

                {isSignUp && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
                    <p className="font-semibold mb-1">💰 Empiezas con $1,000 USD</p>
                    <p className="text-blue-700">Solo puedes crear cuenta si Cheche agregó tu correo a la lista.</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-polyblue text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader size={20} className="animate-spin" />
                      {isSignUp ? 'Creando cuenta...' : 'Iniciando sesión...'}
                    </>
                  ) : isSignUp ? (
                    'Crear cuenta'
                  ) : (
                    'Iniciar sesión'
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <button
                  onClick={() => {
                    setIsSignUp(!isSignUp)
                    setError(null)
                    setSuccess(null)
                  }}
                  className="text-polyblue font-semibold hover:underline"
                >
                  {isSignUp ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="text-center mt-6 text-sm text-gray-500">
          <p>Evento familiar de predicciones</p>
        </div>
      </div>
    </div>
  )
}
