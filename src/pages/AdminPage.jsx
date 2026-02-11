import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { Plus, CheckCircle, XCircle, AlertCircle, Trash2 } from 'lucide-react'

export default function AdminPage() {
  const { profile } = useAuth()
  const [markets, setMarkets] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Create market form
  const [newMarket, setNewMarket] = useState({
    question: '',
    description: '',
    image_url: ''
  })
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [createSuccess, setCreateSuccess] = useState(null)

  useEffect(() => {
    if (profile?.is_admin) {
      fetchAllMarkets()
    }
  }, [profile])

  const fetchAllMarkets = async () => {
    try {
      const { data, error } = await supabase
        .from('markets')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setMarkets(data || [])
    } catch (error) {
      console.error('Error al obtener mercados:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateMarket = async (e) => {
    e.preventDefault()
    setCreateError(null)
    setCreateSuccess(null)
    setCreateLoading(true)

    try {
      if (!newMarket.question.trim()) {
        throw new Error('La pregunta es requerida')
      }

      const { data, error } = await supabase
        .from('markets')
        .insert([
          {
            question: newMarket.question.trim(),
            description: newMarket.description.trim() || null,
            image_url: newMarket.image_url.trim() || null,
            yes_pool: 1000.00,
            no_pool: 1000.00,
            outcome: 'PENDING',
            closed: false
          }
        ])
        .select()

      if (error) throw error

      setCreateSuccess('✅ Mercado creado exitosamente con $1,000 de liquidez en cada lado')
      setNewMarket({ question: '', description: '', image_url: '' })
      fetchAllMarkets()
      
      // Limpiar mensaje después de 3 segundos
      setTimeout(() => setCreateSuccess(null), 3000)
    } catch (error) {
      setCreateError(error.message)
    } finally {
      setCreateLoading(false)
    }
  }

  const handleResolveMarket = async (marketId, outcome) => {
    const market = markets.find(m => m.id === marketId)
    const confirmMsg = `⚠️ CONFIRMACIÓN REQUERIDA\n\n¿Estás seguro de resolver este mercado como "${outcome}"?\n\nMercado: ${market?.question}\n\nEsta acción:\n• Es IRREVERSIBLE\n• Pagará $1.00 por acción a los ganadores de ${outcome}\n• Cerrará el mercado permanentemente\n\n¿Deseas continuar?`
    
    if (!confirm(confirmMsg)) return

    try {
      const { data, error } = await supabase.rpc('resolve_market', {
        p_market_id: marketId,
        p_outcome: outcome
      })

      if (error) throw error

      alert(`✅ Mercado resuelto exitosamente!\n\nGanador: ${outcome}\nTotal pagado: $${data.total_paid.toFixed(2)}`)
      fetchAllMarkets()
    } catch (error) {
      alert(`❌ Error al resolver mercado:\n${error.message}`)
    }
  }

  if (!profile?.is_admin) {
    return (
      <div className="flex items-center justify-center min-h-screen-safe px-4">
        <div className="text-center bg-white rounded-2xl p-8 border border-red-200 shadow-lg">
          <AlertCircle size={64} className="mx-auto text-red-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Acceso Denegado</h2>
          <p className="text-gray-600">No tienes permisos de administrador</p>
          <p className="text-sm text-gray-500 mt-4">
            Contacta a un administrador para obtener acceso
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen-safe">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-polyblue mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Cargando panel de administración...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen-safe bg-polygray-bg px-4 py-6">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Page Header */}
        <div className="bg-gradient-to-r from-polyblue to-blue-600 rounded-2xl p-6 text-white shadow-xl">
          <h1 className="text-3xl font-bold mb-2">Panel de Administración</h1>
          <p className="text-blue-100">Gestiona mercados y resuelve apuestas</p>
        </div>

        {/* Create Market Form */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-polyblue rounded-xl flex items-center justify-center shadow-lg">
              <Plus size={28} className="text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Crear Nuevo Mercado</h2>
              <p className="text-sm text-gray-600">Se inyectarán automáticamente $1,000 de liquidez</p>
            </div>
          </div>

          {/* Success Message */}
          {createSuccess && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
              <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
              <p className="text-green-800 text-sm flex-1">{createSuccess}</p>
            </div>
          )}

          {/* Error Message */}
          {createError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-sm flex-1">{createError}</p>
            </div>
          )}

          <form onSubmit={handleCreateMarket} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Pregunta del Mercado *
              </label>
              <input
                type="text"
                value={newMarket.question}
                onChange={(e) => setNewMarket({ ...newMarket, question: e.target.value })}
                placeholder="¿Lloverá mañana en Miami?"
                className="w-full px-4 py-3 rounded-lg border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition text-base"
                required
              />
              <p className="text-xs text-gray-500 mt-1.5">
                Debe ser una pregunta clara que pueda responderse con SÍ o NO
              </p>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Descripción (Opcional)
              </label>
              <textarea
                value={newMarket.description}
                onChange={(e) => setNewMarket({ ...newMarket, description: e.target.value })}
                placeholder="Contexto adicional sobre el mercado..."
                rows="3"
                className="w-full px-4 py-3 rounded-lg border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition resize-none text-base"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                URL de Imagen (Opcional)
              </label>
              <input
                type="url"
                value={newMarket.image_url}
                onChange={(e) => setNewMarket({ ...newMarket, image_url: e.target.value })}
                placeholder="https://example.com/image.jpg"
                className="w-full px-4 py-3 rounded-lg border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition text-base"
              />
            </div>

            <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 text-sm text-blue-900">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold mb-1">Liquidez Automática</p>
                  <p>Al crear el mercado, se inyectarán automáticamente <strong>1,000 tokens</strong> a cada lado (SÍ y NO), estableciendo un precio inicial de 50¢ para ambos.</p>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={createLoading}
              className="w-full bg-polyblue text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 active:bg-blue-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20"
            >
              {createLoading ? 'Creando Mercado...' : 'Crear Mercado'}
            </button>
          </form>
        </div>

        {/* Markets List */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            Todos los Mercados ({markets.length})
          </h2>

          {markets.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Trash2 size={48} className="mx-auto mb-3 opacity-50" />
              <p>No hay mercados creados todavía</p>
            </div>
          ) : (
            <div className="space-y-4">
              {markets.map((market) => {
                const totalPool = parseFloat(market.yes_pool) + parseFloat(market.no_pool)
                const yesPrice = (parseFloat(market.yes_pool) / totalPool * 100).toFixed(1)
                const noPrice = (parseFloat(market.no_pool) / totalPool * 100).toFixed(1)

                return (
                  <div
                    key={market.id}
                    className={`border-2 rounded-xl p-5 transition-all ${
                      market.closed
                        ? 'bg-gray-50 border-gray-300'
                        : 'bg-white border-gray-200 hover:border-polyblue hover:shadow-md'
                    }`}
                  >
                    {/* Market Header */}
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex-1">
                        <h3 className="font-bold text-gray-900 text-lg mb-1 leading-snug">
                          {market.question}
                        </h3>
                        {market.description && (
                          <p className="text-sm text-gray-600 leading-relaxed">{market.description}</p>
                        )}
                      </div>
                      
                      {market.closed && (
                        <div className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm shadow-sm ${
                          market.outcome === 'YES'
                            ? 'bg-emerald-100 text-polygreen border-2 border-polygreen'
                            : 'bg-rose-100 text-polyred border-2 border-polyred'
                        }`}>
                          {market.outcome === 'YES' ? (
                            <CheckCircle size={18} strokeWidth={2.5} />
                          ) : (
                            <XCircle size={18} strokeWidth={2.5} />
                          )}
                          GANÓ {market.outcome}
                        </div>
                      )}
                    </div>

                    {/* Market Stats */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-emerald-50 rounded-lg p-3 border-2 border-emerald-200">
                        <div className="text-xs font-semibold text-gray-600 mb-1">SÍ</div>
                        <div className="text-2xl font-bold text-polygreen">{yesPrice}¢</div>
                        <div className="text-xs text-gray-600 mt-1 font-medium">
                          Pool: ${parseFloat(market.yes_pool).toFixed(2)}
                        </div>
                      </div>
                      
                      <div className="bg-rose-50 rounded-lg p-3 border-2 border-rose-200">
                        <div className="text-xs font-semibold text-gray-600 mb-1">NO</div>
                        <div className="text-2xl font-bold text-polyred">{noPrice}¢</div>
                        <div className="text-xs text-gray-600 mt-1 font-medium">
                          Pool: ${parseFloat(market.no_pool).toFixed(2)}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    {!market.closed ? (
                      <div className="grid grid-cols-2 gap-3 pt-4 border-t-2 border-gray-200">
                        <button
                          onClick={() => handleResolveMarket(market.id, 'YES')}
                          className="flex items-center justify-center gap-2 bg-polygreen hover:bg-green-700 active:bg-green-800 text-white py-3 rounded-xl font-bold transition-all shadow-lg shadow-green-500/20"
                        >
                          <CheckCircle size={20} strokeWidth={2.5} />
                          Gana SÍ
                        </button>
                        
                        <button
                          onClick={() => handleResolveMarket(market.id, 'NO')}
                          className="flex items-center justify-center gap-2 bg-polyred hover:bg-red-700 active:bg-red-800 text-white py-3 rounded-xl font-bold transition-all shadow-lg shadow-red-500/20"
                        >
                          <XCircle size={20} strokeWidth={2.5} />
                          Gana NO
                        </button>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 mt-4 pt-4 border-t-2 border-gray-200 text-center">
                        Resuelto el {new Date(market.resolved_at).toLocaleString('es-ES', {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}