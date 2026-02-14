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

  const [isMultiple, setIsMultiple] = useState(false)
  const [groupTopic, setGroupTopic] = useState('')
  const [multipleOptions, setMultipleOptions] = useState(['', ''])

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
      if (isMultiple) {
        if (!groupTopic.trim()) throw new Error('El tópico general es requerido')
        const validOptions = multipleOptions.filter(opt => opt.trim() !== '')
        if (validOptions.length < 2) throw new Error('Debes ingresar al menos 2 opciones')

        for (const opt of validOptions) {
          const { error: createErr } = await supabase.rpc('create_market_with_liquidity', {
            p_question: opt.trim(),
            p_description: newMarket.description.trim() || null,
            p_image_url: newMarket.image_url.trim() || null
          })
          if (createErr) throw createErr

          await supabase
            .from('markets')
            .update({ group_topic: groupTopic.trim() })
            .eq('question', opt.trim())
        }
        setCreateSuccess(`✅ ${validOptions.length} submercados creados bajo el tópico: ${groupTopic}`)
      } else {
        if (!newMarket.question.trim()) throw new Error('La pregunta es requerida')
        const { error } = await supabase.rpc('create_market_with_liquidity', {
          p_question: newMarket.question.trim(),
          p_description: newMarket.description.trim() || null,
          p_image_url: newMarket.image_url.trim() || null
        })
        if (error) throw error
        setCreateSuccess('✅ Mercado creado exitosamente')
      }

      setNewMarket({ question: '', description: '', image_url: '' })
      setGroupTopic('')
      setMultipleOptions(['', ''])
      setIsMultiple(false)
      fetchAllMarkets()
      
      setTimeout(() => setCreateSuccess(null), 5000)
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
          <p className="text-blue-100">Modelo CPMM - Liquidez: 1200/1200 tokens</p>
        </div>

        {/* Create Market Form */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-polyblue rounded-xl flex items-center justify-center shadow-lg">
              <Plus size={28} className="text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Crear Nuevo Mercado</h2>
              <p className="text-sm text-gray-600">Se inicializará con 1200 tokens de liquidez CPMM</p>
            </div>
          </div>

          {createSuccess && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
              <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
              <p className="text-green-800 text-sm flex-1">{createSuccess}</p>
            </div>
          )}

          {createError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-sm flex-1">{createError}</p>
            </div>
          )}

          <form onSubmit={handleCreateMarket} className="space-y-5">
            <div className="flex items-center justify-between bg-gray-50 p-4 rounded-xl border border-gray-200">
              <div>
                <h3 className="font-bold text-gray-900">Mercado Múltiple</h3>
                <p className="text-xs text-gray-500">Agrupa varias opciones bajo un mismo tema</p>
              </div>
              <button
                type="button"
                onClick={() => setIsMultiple(!isMultiple)}
                className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors shadow-inner ${isMultiple ? 'bg-polyblue' : 'bg-gray-300'}`}
              >
                <div className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform ${isMultiple ? 'translate-x-6' : 'translate-x-0'}`}></div>
              </button>
            </div>

            {isMultiple ? (
              <div className="space-y-4 bg-blue-50/50 p-5 rounded-xl border border-blue-100">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Tópico General * (Ej: ¿Quién comerá más?)
                  </label>
                  <input
                    type="text"
                    value={groupTopic}
                    onChange={(e) => setGroupTopic(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition"
                    required={isMultiple}
                  />
                </div>
                <div className="space-y-3">
                  <label className="block text-sm font-bold text-gray-700">
                    Opciones / Participantes *
                  </label>
                  {multipleOptions.map((opt, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => {
                          const newOpts = [...multipleOptions];
                          newOpts[idx] = e.target.value;
                          setMultipleOptions(newOpts);
                        }}
                        placeholder={`Opción ${idx + 1} (Ej: Papá)`}
                        className="flex-1 px-4 py-3 rounded-lg border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition"
                        required={isMultiple}
                      />
                      {multipleOptions.length > 2 && (
                        <button 
                          type="button" 
                          onClick={() => setMultipleOptions(multipleOptions.filter((_, i) => i !== idx))} 
                          className="px-3 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 size={24} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button 
                    type="button" 
                    onClick={() => setMultipleOptions([...multipleOptions, ''])} 
                    className="text-polyblue font-bold text-sm flex items-center gap-1 mt-3 px-2 py-1 hover:bg-blue-100 rounded-lg transition-colors"
                  >
                    <Plus size={18} /> Agregar otra opción
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Pregunta del Mercado *
                </label>
                <input
                  type="text"
                  value={newMarket.question}
                  onChange={(e) => setNewMarket({ ...newMarket, question: e.target.value })}
                  placeholder="¿Lloverá mañana en Miami?"
                  className="w-full px-4 py-3 rounded-lg border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition"
                  style={{ fontSize: '16px' }}
                  required={!isMultiple}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Descripción (Opcional)
              </label>
              <textarea
                value={newMarket.description}
                onChange={(e) => setNewMarket({ ...newMarket, description: e.target.value })}
                placeholder="Contexto adicional sobre el mercado..."
                rows="3"
                className="w-full px-4 py-3 rounded-lg border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition resize-none"
                style={{ fontSize: '16px' }}
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
                className="w-full px-4 py-3 rounded-lg border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition"
                style={{ fontSize: '16px' }}
              />
            </div>

            <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 text-sm text-blue-900">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold mb-1">Modelo CPMM Activado</p>
                  <p className="mb-2">Al crear el mercado, se inicializará con:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-800">
                    <li><strong>1200 tokens YES</strong> en el pool</li>
                    <li><strong>1200 tokens NO</strong> en el pool</li>
                    <li>Precio inicial: <strong>50.0¢</strong> para ambos lados</li>
                    <li>Fee de trading: <strong>2%</strong> por transacción</li>
                    <li>Límites de precio: <strong>1¢ - 99¢</strong></li>
                  </ul>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={createLoading}
              className="w-full bg-polyblue text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 active:bg-blue-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20 no-select tap-feedback"
            >
              {createLoading ? 'Creando Mercado...' : 'Crear Mercado CPMM'}
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
                const yesPrice = (parseFloat(market.no_pool) / totalPool * 100).toFixed(1)
                const noPrice = (parseFloat(market.yes_pool) / totalPool * 100).toFixed(1)

                return (
                  <div
                    key={market.id}
                    className={`border-2 rounded-xl p-5 transition-all ${
                      market.closed
                        ? 'bg-gray-50 border-gray-300'
                        : 'bg-white border-gray-200 hover:border-polyblue hover:shadow-md'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex-1">
                        <h3 className="font-bold text-gray-900 text-lg mb-1 leading-snug">
                          {market.group_topic ? (
                            <>
                              <span className="text-polyblue">🎯 {market.group_topic}</span>
                              <span className="text-gray-400 mx-2">—</span>
                              {market.question}
                            </>
                          ) : (
                            market.question
                          )}
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

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-emerald-50 rounded-lg p-3 border-2 border-emerald-200">
                        <div className="text-xs font-semibold text-gray-600 mb-1">YES</div>
                        <div className="text-2xl font-bold text-polygreen">{yesPrice}¢</div>
                        <div className="text-xs text-gray-600 mt-1 font-medium">
                          Pool: {parseFloat(market.yes_pool).toFixed(2)} tokens
                        </div>
                      </div>
                      
                      <div className="bg-rose-50 rounded-lg p-3 border-2 border-rose-200">
                        <div className="text-xs font-semibold text-gray-600 mb-1">NO</div>
                        <div className="text-2xl font-bold text-polyred">{noPrice}¢</div>
                        <div className="text-xs text-gray-600 mt-1 font-medium">
                          Pool: {parseFloat(market.no_pool).toFixed(2)} tokens
                        </div>
                      </div>
                    </div>

                    {!market.closed ? (
                      <div className="grid grid-cols-2 gap-3 pt-4 border-t-2 border-gray-200">
                        <button
                          onClick={() => handleResolveMarket(market.id, 'YES')}
                          className="flex items-center justify-center gap-2 bg-polygreen hover:bg-green-700 active:bg-green-800 text-white py-3 rounded-xl font-bold transition-all shadow-lg shadow-green-500/20 no-select tap-feedback"
                        >
                          <CheckCircle size={20} strokeWidth={2.5} />
                          Gana YES
                        </button>
                        
                        <button
                          onClick={() => handleResolveMarket(market.id, 'NO')}
                          className="flex items-center justify-center gap-2 bg-polyred hover:bg-red-700 active:bg-red-800 text-white py-3 rounded-xl font-bold transition-all shadow-lg shadow-red-500/20 no-select tap-feedback"
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