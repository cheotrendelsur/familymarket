import { Component } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

/** Evita la pantalla en blanco: si algo falla al renderizar, muestra una salida clara. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Visible en consola en desarrollo; en producción se silencian los logs.
    console.error('FamilyMarket UI error:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-polygray-bg">
        <div className="max-w-sm w-full bg-white rounded-2xl border border-red-200 shadow-lg p-8 text-center">
          <AlertCircle size={56} className="mx-auto text-polyred mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Algo salió mal</h2>
          <p className="text-gray-600 text-sm mb-6">
            La pantalla tuvo un problema inesperado. Tus saldos y operaciones están a salvo.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="w-full inline-flex items-center justify-center gap-2 bg-polyblue text-white py-3 rounded-xl font-bold"
          >
            <RefreshCw size={18} /> Recargar la app
          </button>
        </div>
      </div>
    )
  }
}
