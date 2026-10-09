import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff, Loader } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useConfirm } from '../components/ConfirmDialog'
import { friendlyAuthError } from '../lib/format'

const inputClass =
  'w-full px-4 py-3 rounded-lg border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition'

export default function AuthPage() {
  const navigate = useNavigate()
  const { user, signIn, signUp } = useAuth()
  const confirm = useConfirm()
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

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
        const { error: signInError } = await signIn(cleanEmail, password)
        if (signInError) throw signInError
        navigate('/', { replace: true })
      }
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setLoading(false)
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
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">{isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}</h2>

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

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3" role="alert">
                <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-red-700 text-sm flex-1">{error}</p>
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
                <p className="text-blue-700">Úsalos sabiamente en el mercado de predicciones</p>
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
        </div>

        <div className="text-center mt-6 text-sm text-gray-500">
          <p>Evento familiar de predicciones</p>
        </div>
      </div>
    </div>
  )
}
