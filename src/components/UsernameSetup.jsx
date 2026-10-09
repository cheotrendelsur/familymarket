import { useState } from 'react'
import { AlertCircle, Loader, User } from 'lucide-react'
import { rpc } from '../lib/api'
import { friendlyError } from '../lib/format'

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/

export default function UsernameSetup({ onComplete }) {
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (loading) return
    setError(null)
    const name = username.trim()

    if (!USERNAME_RE.test(name)) {
      setError('Usa de 3 a 20 caracteres: letras, números o guion bajo (_).')
      return
    }

    setLoading(true)
    try {
      await rpc('set_username', { p_username: name })
      await onComplete()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-br from-polyblue to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <User size={40} className="text-white" strokeWidth={2} />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">¡Bienvenido a FamilyMarket!</h2>
          <p className="text-gray-600">Elige un nombre para aparecer en el Ranking Familiar</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="username" className="block text-sm font-bold text-gray-700 mb-2">
              Nombre de usuario
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="TuNombre123"
              className="w-full px-4 py-3 rounded-lg border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition text-base"
              required
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              maxLength={20}
            />
            <p className="text-xs text-gray-500 mt-1.5">3-20 caracteres. Solo letras, números y guiones bajos (_). Si luego necesitas cambiarlo, pídeselo al dueño.</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2" role="alert">
              <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-sm flex-1">{error}</p>
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
            <p className="font-semibold mb-1">💰 Empiezas con $1,000 USD</p>
            <p className="text-blue-700">Úsalos sabiamente en el mercado de predicciones</p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-polyblue text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader size={20} className="animate-spin" /> Guardando...
              </>
            ) : (
              'Comenzar a jugar'
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
