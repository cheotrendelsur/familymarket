import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { TrendingUp, AlertCircle, Lock, Info, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'

export default function MarketPage() {
  const { profile, refreshProfile } = useAuth()
  const [activeMarkets, setActiveMarkets] = useState([])
  const [closedMarkets, setClosedMarkets] = useState([])
  const [selectedMarket, setSelectedMarket] = useState(null)
  const [chartData, setChartData] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Trading state
  const [tradeSide, setTradeSide] = useState('YES')
  const [tradeMode, setTradeMode] = useState('BUY')
  const [amount, setAmount] = useState('')
  const [userShares, setUserShares] = useState({ YES: 0, NO: 0 })
  const [tradeLoading, setTradeLoading] = useState(false)
  const [tradeError, setTradeError] = useState(null)
  const [slippageTolerance, setSlippageTolerance] = useState(5)

  const [expandedTopics, setExpandedTopics] = useState({})

  const [expandedClosedTopics, setExpandedClosedTopics] = useState({})

  useEffect(() => {
    fetchMarkets()
  }, [])

  useEffect(() => {
    if (selectedMarket) {
      fetchMarketPriceHistory(selectedMarket.id)
      if (!selectedMarket.closed) {
        fetchUserShares(selectedMarket.id)
      }
    }
  }, [selectedMarket])

  const fetchMarkets = async () => {
    try {
      // Mercados activos
      const { data: active, error: activeError } = await supabase
        .from('markets')
        .select('*')
        .eq('closed', false)
        .order('created_at', { ascending: false })

      if (activeError) throw activeError
      setActiveMarkets(active || [])

      // Mercados cerrados
      const { data: closed, error: closedError } = await supabase
        .from('markets')
        .select('*')
        .eq('closed', true)
        .order('resolved_at', { ascending: false })

      if (closedError) throw closedError
      setClosedMarkets(closed || [])

      // Seleccionar automáticamente el mercado activo más reciente
      if (active && active.length > 0) {
        setSelectedMarket(active[0])
      } else if (closed && closed.length > 0) {
        setSelectedMarket(closed[0])
      }
    } catch (error) {
      console.error('Error al obtener mercados:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchMarketPriceHistory = async (marketId) => {
    try {
      const { data, error } = await supabase
        .from('market_prices_history')
        .select('*')
        .eq('market_id', marketId)
        .order('created_at', { ascending: true })
        .limit(100)

      if (error) throw error
      
      const formattedData = (data || []).map((item) => ({
        time: new Date(item.created_at).toLocaleTimeString('es-ES', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        yes: parseFloat(item.yes_price) * 100,
        no: parseFloat(item.no_price) * 100,
      }))

      setChartData(formattedData)
    } catch (error) {
      console.error('Error al obtener historial de precios:', error)
    }
  }

  const fetchUserShares = async (marketId) => {
    try {
      const { data, error } = await supabase
        .from('shares')
        .select('side, count')
        .eq('user_id', profile.id)
        .eq('market_id', marketId)

      if (error) throw error
      
      const shares = { YES: 0, NO: 0 }
      data?.forEach(share => {
        shares[share.side] = parseFloat(share.count)
      })
      
      setUserShares(shares)
    } catch (error) {
      console.error('Error al obtener acciones del usuario:', error)
    }
  }

  const calculatePrice = (market, side) => {
    const totalPool = parseFloat(market.yes_pool) + parseFloat(market.no_pool)
    // CORRECCIÓN CPMM: El precio lo define la piscina CONTRARIA
    const pool = side === 'YES' ? parseFloat(market.no_pool) : parseFloat(market.yes_pool)
    return pool / totalPool
  }

  const calculateMaxPrice = () => {
    const currentPrice = calculatePrice(selectedMarket, tradeSide)
    const tolerance = slippageTolerance / 100
    return currentPrice * (1 + tolerance)
  }

  const calculateMinPrice = () => {
    const currentPrice = calculatePrice(selectedMarket, tradeSide)
    const tolerance = slippageTolerance / 100
    return currentPrice * (1 - tolerance)
  }

  const handleTrade = async () => {
    if (!selectedMarket || !amount || parseFloat(amount) <= 0) return

    const confirmMessage = tradeMode === 'BUY' 
      ? `¿Confirmas la COMPRA de tokens ${tradeSide} por $${amount}?` 
      : `¿Confirmas la VENTA de ${amount} tokens ${tradeSide}?`;
      
    if (!window.confirm(confirmMessage)) return; // Si le da a Cancelar, aborta

    setTradeError(null)
    setTradeLoading(true)

    try {
      if (tradeMode === 'BUY') {
        if (parseFloat(amount) > profile.balance) {
          throw new Error('Saldo insuficiente')
        }

        const maxPrice = calculateMaxPrice()

        const { data, error } = await supabase.rpc('buy_shares', {
          p_market_id: selectedMarket.id,
          p_side: tradeSide,
          p_investment: parseFloat(amount),
          p_max_price: maxPrice
        })

        if (error) throw error
        
        toast.success(
          <div className="flex flex-col gap-1">
            <span className="font-bold text-base text-gray-900">¡Compra exitosa!</span>
            <span className="text-sm text-gray-600">Adquiriste: <b className="text-polygreen">{data.shares_bought.toFixed(2)}</b> acciones de {tradeSide}</span>
            <span className="text-sm text-gray-600">Precio promedio: <b className="text-gray-900">{(data.price * 100).toFixed(2)}¢</b></span>
            <span className="text-sm text-gray-600">Fee pagado: <b className="text-polyred">${data.fee_paid ? data.fee_paid.toFixed(2) : '0.00'}</b></span>
            <span className="text-xs text-gray-500 mt-2 flex items-center gap-1 font-semibold">
              ⚡ {data.daily_moves_remaining} movimientos restantes
            </span>
          </div>,
          { duration: 5000 }
        )
        // ==========================================

      } else {
        if (parseFloat(amount) > userShares[tradeSide]) {
          throw new Error(`No tienes suficientes acciones de ${tradeSide}`)
        }

        const minPrice = calculateMinPrice()

        const { data, error } = await supabase.rpc('sell_shares', {
          p_market_id: selectedMarket.id,
          p_side: tradeSide,
          p_shares_to_sell: parseFloat(amount),
          p_min_price: minPrice
        })

        if (error) throw error
        
        toast.success(
          <div className="flex flex-col gap-1">
            <span className="font-bold text-base text-gray-900">¡Venta exitosa!</span>
            <span className="text-sm text-gray-600">Vendiste: <b className="text-gray-900">{data.shares_sold.toFixed(2)}</b> acciones de {tradeSide}</span>
            <span className="text-sm text-gray-600">Recibiste: <b className="text-polygreen">${data.payout.toFixed(2)}</b></span>
            <span className="text-xs text-gray-500 mt-2 flex items-center gap-1 font-semibold">
              ⚡ {data.daily_moves_remaining} movimientos restantes
            </span>
          </div>,
          { duration: 5000 }
        )
        // ==========================================
      }

      setAmount('')
      refreshProfile()
      fetchUserShares(selectedMarket.id)
      fetchMarkets()
      fetchMarketPriceHistory(selectedMarket.id)
    } catch (error) {
      setTradeError(error.message)
    } finally {
      setTradeLoading(false)
    }
  }

  const currentPrice = selectedMarket ? calculatePrice(selectedMarket, tradeSide) : 0
  const isMarketClosed = selectedMarket?.closed || false

  const estimatedReturn = useMemo(() => {
    if (!selectedMarket || !amount || parseFloat(amount) <= 0) return null

    const yesPool = parseFloat(selectedMarket.yes_pool)
    const noPool = parseFloat(selectedMarket.no_pool)
    const k = yesPool * noPool
    const FEE_RATE = 0.02

    if (tradeMode === 'BUY') {
      const investment = parseFloat(amount)
      const fee = investment * FEE_RATE
      const investmentAfterFee = investment - fee

      const sharesBase = investmentAfterFee
      let sharesFromSwap = 0
      let finalPrice = 0

      if (tradeSide === 'YES') {
        const newNoPool = noPool + investmentAfterFee
        const newYesPool = k / newNoPool
        sharesFromSwap = yesPool - newYesPool
        finalPrice = newNoPool / (newYesPool + newNoPool)
      } else {
        const newYesPool = yesPool + investmentAfterFee
        const newNoPool = k / newYesPool
        sharesFromSwap = noPool - newNoPool
        finalPrice = newYesPool / (newYesPool + newNoPool)
      }

      const totalShares = sharesBase + sharesFromSwap
      const avgPrice = investment / totalShares
      const priceImpact = ((finalPrice - currentPrice) / currentPrice) * 100

      return {
        type: 'BUY',
        shares: totalShares,
        avgPrice: avgPrice,
        fee: fee,
        finalPrice: finalPrice,
        priceImpact: priceImpact
      }

    } else {
      const sharesToSell = parseFloat(amount)
      let Y, N
      if (tradeSide === 'YES') {
        Y = yesPool
        N = noPool
      } else {
        Y = noPool
        N = yesPool
      }
      
      const a = 1.0
      const b = Y + N - sharesToSell
      const c = Y * (N - sharesToSell) - k
      const discriminant = (b * b) - (4 * a * c)
      
      if (discriminant < 0) return { error: 'La cantidad es demasiado alta para vender' }
      
      const swapAmount = (-b + Math.sqrt(discriminant)) / (2 * a)
      if (swapAmount < 0 || swapAmount > sharesToSell) return { error: 'Error en el cálculo' }
      
      const payoutBeforeFee = sharesToSell - swapAmount
      const fee = payoutBeforeFee * FEE_RATE
      const payoutAfterFee = payoutBeforeFee - fee
      
      if (payoutAfterFee <= 0) return { error: 'El monto de venta es muy bajo' }
      
      let newYesPool, newNoPool
      if (tradeSide === 'YES') {
        newYesPool = yesPool + swapAmount
        newNoPool = k / newYesPool
      } else {
        newNoPool = noPool + swapAmount
        newYesPool = k / newNoPool
      }
      
      const avgPrice = payoutAfterFee / sharesToSell
      const newTotalPool = newYesPool + newNoPool
      const finalPrice = tradeSide === 'YES' ? newNoPool / newTotalPool : newYesPool / newTotalPool
      const priceImpact = ((finalPrice - currentPrice) / currentPrice) * 100

      return {
        type: 'SELL',
        payout: payoutAfterFee,
        avgPrice: avgPrice,
        fee: fee,
        finalPrice: finalPrice,
        priceImpact: priceImpact
      }
    }
  }, [amount, selectedMarket, tradeSide, tradeMode, currentPrice])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen-safe">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-polyblue mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Cargando mercados...</p>
        </div>
      </div>
    )
  }

  if (activeMarkets.length === 0 && closedMarkets.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen-safe px-4">
        <div className="text-center">
          <TrendingUp size={64} className="mx-auto text-gray-400 mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            No hay mercados disponibles
          </h3>
          <p className="text-gray-600">
            Espera a que un administrador cree mercados
          </p>
        </div>
      </div>
    )
  }

  const toggleTopic = (topic) => {
    setExpandedTopics(prev => ({ ...prev, [topic]: !prev[topic] }))
  }

  const toggleClosedTopic = (topic) => {
    setExpandedClosedTopics(prev => ({ ...prev, [topic]: !prev[topic] }))
  }

  const particularMarkets = activeMarkets.filter(m => !m.group_topic)
  
  const multipleMarketsGroups = activeMarkets
    .filter(m => m.group_topic)
    .reduce((acc, market) => {
      if (!acc[market.group_topic]) acc[market.group_topic] = []
      acc[market.group_topic].push(market)
      return acc
    }, {})

  const particularClosedMarkets = closedMarkets.filter(m => !m.group_topic)
  
  const multipleClosedMarketsGroups = closedMarkets
    .filter(m => m.group_topic)
    .reduce((acc, market) => {
      if (!acc[market.group_topic]) acc[market.group_topic] = []
      acc[market.group_topic].push(market)
      return acc
    }, {})

  return (
    <div className="min-h-screen-safe bg-polygray-bg pb-6">
      {/* ============================================= */}
      {/* SECCIÓN SUPERIOR: GRÁFICO */}
      {/* ============================================= */}
      <div className="bg-white border-b border-gray-200 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h2 className="text-lg font-bold text-gray-900 mb-1">
                {selectedMarket?.question}
              </h2>
              {isMarketClosed && (
                <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg text-sm font-bold ${
                  selectedMarket.outcome === 'YES'
                    ? 'bg-emerald-100 text-polygreen'
                    : 'bg-rose-100 text-polyred'
                }`}>
                  <Lock size={14} />
                  MERCADO CERRADO - Ganó {selectedMarket.outcome}
                </div>
              )}
            </div>
          </div>

          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis 
                  dataKey="time" 
                  tick={{ fontSize: 12, fill: '#6B7280' }}
                  stroke="#9CA3AF"
                />
                <YAxis 
                  tick={{ fontSize: 12, fill: '#6B7280' }}
                  stroke="#9CA3AF"
                  domain={[0, 100]}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#FFFFFF', 
                    border: '1px solid #E5E7EB',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="yes" 
                  stroke="#009E60" 
                  strokeWidth={3}
                  dot={false}
                  name="YES (%)"
                />
                <Line 
                  type="monotone" 
                  dataKey="no" 
                  stroke="#E02D3C" 
                  strokeWidth={3}
                  dot={false}
                  name="NO (%)"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-60 flex items-center justify-center text-gray-500 bg-gray-50 rounded-lg">
              No hay datos de precio todavía
            </div>
          )}
        </div>
      </div>

      {/* ============================================= */}
      {/* SECCIÓN MEDIA: LISTA DE MERCADOS */}
      {/* ============================================= */}
      <div className="bg-white p-4 border-b border-gray-200">
        <div className="max-w-7xl mx-auto">
          {/* Mercados Activos */}
          {/* Mercados Activos */}
          {activeMarkets.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wide">
                Activos
              </h3>
              
              <div className="space-y-4">
                {/* === BLOQUE A: PARTICULARES === */}
                {particularMarkets.length > 0 && (
                  <div className="space-y-2">
                    {particularMarkets.map((market) => {
                      const yesPrice = calculatePrice(market, 'YES')
                      const isSelected = selectedMarket?.id === market.id

                      return (
                        <button
                          key={market.id}
                          onClick={() => setSelectedMarket(market)}
                          className={`w-full text-left bg-white rounded-lg p-3 border-2 transition-all ${
                            isSelected
                              ? 'border-polyblue shadow-md'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-sm text-gray-900 flex-1 pr-4">
                              {market.question}
                            </p>
                            <div className="text-right">
                              <div className="text-lg font-bold text-polygreen">
                                {(yesPrice * 100).toFixed(0)}%
                              </div>
                              <div className="text-xs text-gray-500">YES</div>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* === BLOQUE B: MÚLTIPLES (ACORDEÓN) === */}
                {Object.keys(multipleMarketsGroups).length > 0 && (
                  <div className="space-y-3 mt-4">
                    {Object.entries(multipleMarketsGroups).map(([topic, markets]) => (
                      <div key={topic} className="bg-white border-2 border-polyblue/20 rounded-xl overflow-hidden shadow-sm transition-all">
                        
                        <button
                          onClick={() => toggleTopic(topic)}
                          className="w-full flex items-center justify-between p-4 bg-blue-50/50 hover:bg-blue-50 transition-colors tap-feedback"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-polyblue text-white rounded-lg flex items-center justify-center font-bold shadow-sm text-sm">
                              {markets.length}
                            </div>
                            <h4 className="font-bold text-gray-900 text-sm text-left">{topic}</h4>
                          </div>
                          <ChevronDown 
                            size={20} 
                            className={`text-polyblue transform transition-transform duration-300 ${expandedTopics[topic] ? 'rotate-180' : ''}`} 
                          />
                        </button>
                        
                        {expandedTopics[topic] && (
                          <div className="p-3 border-t-2 border-polyblue/10 bg-gray-50/50 space-y-2">
                            {markets.map((market) => {
                              const yesPrice = calculatePrice(market, 'YES')
                              const isSelected = selectedMarket?.id === market.id

                              return (
                                <button
                                  key={market.id}
                                  onClick={() => setSelectedMarket(market)}
                                  className={`w-full text-left bg-white rounded-lg p-3 border-2 transition-all ${
                                    isSelected
                                      ? 'border-polyblue shadow-md'
                                      : 'border-gray-200 hover:border-gray-300'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <p className="font-medium text-sm text-gray-900 flex-1 pr-4">
                                      {market.question}
                                    </p>
                                    <div className="text-right">
                                      <div className="text-lg font-bold text-polygreen">
                                        {(yesPrice * 100).toFixed(0)}%
                                      </div>
                                      <div className="text-xs text-gray-500">YES</div>
                                    </div>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mercados Cerrados */}
          {/* Mercados Cerrados */}
          {closedMarkets.length > 0 && (
            <div className="mt-8">
              <h3 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wide">
                Cerrados
              </h3>
              
              <div className="space-y-4">
                {/* === BLOQUE A: CERRADOS PARTICULARES === */}
                {particularClosedMarkets.length > 0 && (
                  <div className="space-y-2">
                    {particularClosedMarkets.map((market) => {
                      const yesPrice = calculatePrice(market, 'YES')
                      const isSelected = selectedMarket?.id === market.id

                      return (
                        <button
                          key={market.id}
                          onClick={() => setSelectedMarket(market)}
                          className={`w-full text-left bg-white rounded-lg p-3 border-2 transition-all opacity-70 hover:opacity-100 ${
                            isSelected
                              ? 'border-polyblue shadow-md'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-sm text-gray-700 flex-1 pr-4">
                              {market.question}
                            </p>
                            <div className="text-right">
                              <div className={`text-sm font-bold ${
                                market.outcome === 'YES' ? 'text-polygreen' : 'text-polyred'
                              }`}>
                                Ganó {market.outcome}
                              </div>
                              <div className="text-xs text-gray-500">
                                {(yesPrice * 100).toFixed(0)}% final
                              </div>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* === BLOQUE B: CERRADOS MÚLTIPLES (ACORDEÓN GRIS) === */}
                {Object.keys(multipleClosedMarketsGroups).length > 0 && (
                  <div className="space-y-3 mt-4">
                    {Object.entries(multipleClosedMarketsGroups).map(([topic, markets]) => (
                      <div key={topic} className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden shadow-sm transition-all opacity-90 hover:opacity-100">
                        
                        <button
                          onClick={() => toggleClosedTopic(topic)}
                          className="w-full flex items-center justify-between p-4 bg-gray-100 hover:bg-gray-200 transition-colors tap-feedback"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-gray-500 text-white rounded-lg flex items-center justify-center font-bold shadow-sm text-sm">
                              {markets.length}
                            </div>
                            <h4 className="font-bold text-gray-700 text-sm text-left">{topic}</h4>
                          </div>
                          <ChevronDown 
                            size={20} 
                            className={`text-gray-500 transform transition-transform duration-300 ${expandedClosedTopics[topic] ? 'rotate-180' : ''}`} 
                          />
                        </button>
                        
                        {expandedClosedTopics[topic] && (
                          <div className="p-3 border-t-2 border-gray-200 bg-gray-50/50 space-y-2">
                            {markets.map((market) => {
                              const yesPrice = calculatePrice(market, 'YES')
                              const isSelected = selectedMarket?.id === market.id

                              return (
                                <button
                                  key={market.id}
                                  onClick={() => setSelectedMarket(market)}
                                  className={`w-full text-left bg-white rounded-lg p-3 border-2 transition-all ${
                                    isSelected
                                      ? 'border-polyblue shadow-md'
                                      : 'border-gray-200 hover:border-gray-300'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <p className="font-medium text-sm text-gray-700 flex-1 pr-4">
                                      {market.question}
                                    </p>
                                    <div className="text-right">
                                      <div className={`text-sm font-bold ${
                                        market.outcome === 'YES' ? 'text-polygreen' : 'text-polyred'
                                      }`}>
                                        Ganó {market.outcome}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        {(yesPrice * 100).toFixed(0)}% final
                                      </div>
                                    </div>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ============================================= */}
      {/* SECCIÓN INFERIOR: TRADING (SOLO SI ESTÁ ACTIVO) */}

      {/* ============================================= */}
      {/* SECCIÓN INFERIOR: TRADING (SOLO SI ESTÁ ACTIVO) */}
      {/* ============================================= */}
      {selectedMarket && !isMarketClosed && (
        <div className="bg-white mt-4 mx-4 rounded-xl border border-gray-200 p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            <h3 className="text-xl font-bold text-gray-900">Operar</h3>

            {/* Side Selector */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setTradeSide('YES')}
                className={`py-4 rounded-xl font-bold transition-all border-2 ${
                  tradeSide === 'YES'
                    ? 'bg-emerald-50 border-polygreen text-polygreen shadow-lg shadow-green-500/20'
                    : 'bg-white border-gray-200 text-gray-600'
                }`}
              >
                <div className="text-xs mb-1">YES</div>
                <div className="text-2xl">{(calculatePrice(selectedMarket, 'YES') * 100).toFixed(1)}¢</div>
              </button>

              <button
                onClick={() => setTradeSide('NO')}
                className={`py-4 rounded-xl font-bold transition-all border-2 ${
                  tradeSide === 'NO'
                    ? 'bg-rose-50 border-polyred text-polyred shadow-lg shadow-red-500/20'
                    : 'bg-white border-gray-200 text-gray-600'
                }`}
              >
                <div className="text-xs mb-1">NO</div>
                <div className="text-2xl">{(calculatePrice(selectedMarket, 'NO') * 100).toFixed(1)}¢</div>
              </button>
            </div>

            {/* Mode Toggle */}
            <div className="grid grid-cols-2 gap-2 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setTradeMode('BUY')}
                className={`py-2.5 rounded-md font-semibold transition-all ${
                  tradeMode === 'BUY'
                    ? 'bg-white shadow-sm text-gray-900'
                    : 'text-gray-600'
                }`}
              >
                Comprar
              </button>
              <button
                onClick={() => setTradeMode('SELL')}
                className={`py-2.5 rounded-md font-semibold transition-all ${
                  tradeMode === 'SELL'
                    ? 'bg-white shadow-sm text-gray-900'
                    : 'text-gray-600'
                }`}
              >
                Vender
              </button>
            </div>

            {/* Slippage Tolerance */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">
                  Tolerancia de Slippage
                </label>
                <span className="text-sm font-bold text-polyblue">
                  {slippageTolerance}%
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="20"
                step="0.5"
                value={slippageTolerance}
                onChange={(e) => setSlippageTolerance(parseFloat(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-600 mt-2">
                {tradeMode === 'BUY' ? (
                  <p>Precio máximo: <strong>{(calculateMaxPrice() * 100).toFixed(2)}¢</strong></p>
                ) : (
                  <p>Precio mínimo: <strong>{(calculateMinPrice() * 100).toFixed(2)}¢</strong></p>
                )}
              </div>
            </div>

            {/* Amount Input */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                {tradeMode === 'BUY' ? 'Cantidad a invertir' : 'Acciones a vender'}
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-xl font-semibold">
                  {tradeMode === 'BUY' ? '$' : ''}
                </div>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  className="w-full pl-9 pr-4 py-4 text-2xl font-semibold rounded-xl border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition"
                />
              </div>

              <div className="flex justify-between items-center mt-2.5 text-sm">
                <span className="text-gray-600">
                  {tradeMode === 'BUY' ? 'Saldo:' : 'Tienes:'}
                </span>
                <button
                  onClick={() => setAmount(tradeMode === 'BUY' ? profile?.balance.toString() : userShares[tradeSide].toString())}
                  className="font-semibold text-polyblue hover:underline tap-feedback"
                >
                  {tradeMode === 'BUY'
                    ? `$${profile?.balance.toFixed(2)}`
                    : `${userShares[tradeSide].toFixed(2)} ${tradeSide}`
                  }
                </button>
              </div>
            </div>
            
            {estimatedReturn && !estimatedReturn.error && (
              <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 bg-polyblue rounded-lg flex items-center justify-center">
                    <Info size={18} className="text-white" strokeWidth={2.5} />
                  </div>
                  <span className="text-sm font-bold text-gray-900">Resumen de la Orden</span>
                </div>
                
                <div className="space-y-2.5 text-sm">
                  {tradeMode === 'BUY' ? (
                    <>
                      <div className="flex justify-between items-center py-2 border-b border-blue-200">
                        <span className="text-gray-700 font-medium">Recibirás:</span>
                        <span className="font-bold text-gray-900 text-base">
                          {estimatedReturn.shares.toFixed(2)} tokens {tradeSide}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-700">Precio promedio:</span>
                        <span className="font-bold text-gray-900">
                          {(estimatedReturn.avgPrice * 100).toFixed(2)}¢
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-700">Fee (2%):</span>
                        <span className="font-bold text-red-600">
                          -${estimatedReturn.fee.toFixed(2)}
                        </span>
                      </div>
                      <div className="pt-2 mt-2 border-t border-blue-200">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-700">Nuevo precio {tradeSide}:</span>
                          <span className="font-bold text-polyblue text-base">
                            {(estimatedReturn.finalPrice * 100).toFixed(2)}¢
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between items-center py-2 border-b border-blue-200">
                        <span className="text-gray-700 font-medium">Recibirás:</span>
                        <span className="font-bold text-green-600 text-lg">
                          ${estimatedReturn.payout.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-700">Precio promedio:</span>
                        <span className="font-bold text-gray-900">
                          {(estimatedReturn.avgPrice * 100).toFixed(2)}¢
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-700">Fee (2%):</span>
                        <span className="font-bold text-red-600">
                          -${estimatedReturn.fee.toFixed(2)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* NUEVO: ALERTA DE ERROR MATEMÁTICO (EJ: MUCHA VENTA) */}
            {estimatedReturn?.error && (
              <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-yellow-900 font-semibold text-sm mb-1">Advertencia</p>
                  <p className="text-yellow-800 text-sm">{estimatedReturn.error}</p>
                </div>
              </div>
            )}

            {/* Error Message */}
            {tradeError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle size={20} className="text-red-600 flex-shrink-0" />
                <p className="text-red-700 text-sm flex-1">{tradeError}</p>
              </div>
            )}

            {/* Trade Button */}
            <button
              onClick={handleTrade}
              disabled={tradeLoading || !amount || parseFloat(amount) <= 0}
              className={`w-full py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg ${
                tradeMode === 'BUY'
                  ? tradeSide === 'YES'
                    ? 'bg-polygreen hover:bg-green-700 text-white shadow-green-500/20'
                    : 'bg-polyred hover:bg-red-700 text-white shadow-red-500/20'
                  : 'bg-gray-900 hover:bg-gray-800 text-white shadow-gray-500/20'
              }`}
            >
              {tradeLoading
                ? 'Procesando...'
                : `${tradeMode === 'BUY' ? 'Comprar' : 'Vender'} ${tradeSide}`
              }
            </button>
          </div>
        </div>
      )}

      {/* Mensaje de Solo Lectura para Mercados Cerrados */}
      {selectedMarket && isMarketClosed && (
        <div className="max-w-7xl mx-auto px-4 mt-6">
          <div className="bg-gray-50 border-2 border-gray-300 rounded-xl p-6 text-center">
            <Lock size={48} className="mx-auto text-gray-400 mb-3" />
            <h3 className="text-lg font-bold text-gray-700 mb-2">
              Mercado Cerrado
            </h3>
            <p className="text-gray-600">
              Este mercado ya finalizó. Solo puedes ver su historial de precios.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}