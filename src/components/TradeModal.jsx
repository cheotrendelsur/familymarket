import { useState, useEffect, useCallback, useMemo } from 'react'
import { X, AlertCircle, Zap, Info } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'

export default function TradeModal({ market, side, onClose }) {
  const { profile, refreshProfile } = useAuth()
  const [mode, setMode] = useState('BUY')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [userShares, setUserShares] = useState(0)
  const [slippageTolerance, setSlippageTolerance] = useState(5)
  const [dailyMovesRemaining, setDailyMovesRemaining] = useState(null)

  useEffect(() => {
    if (mode === 'SELL') {
      fetchUserShares()
    }
    fetchDailyMovesRemaining()
  }, [mode, market.id, side])

  const fetchUserShares = async () => {
    try {
      const { data, error } = await supabase
        .from('shares')
        .select('count')
        .eq('user_id', profile.id)
        .eq('market_id', market.id)
        .eq('side', side)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      setUserShares(data?.count || 0)
    } catch (error) {
      console.error('Error al obtener acciones:', error)
    }
  }

  const fetchDailyMovesRemaining = async () => {
    try {
      // CORRECCIÓN: Extraemos 'count' en lugar de 'data'
      const { count, error } = await supabase
        .from('transaction_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .gte('created_at', new Date().toISOString().split('T')[0])
        .in('action', ['BUY', 'SELL'])

      if (error) throw error
      // Ahora sí restamos el conteo real
      setDailyMovesRemaining(60 - (count || 0))
    } catch (error) {
      console.error('Error al obtener movimientos diarios:', error)
      setDailyMovesRemaining(60)
    }
  }

  const currentPrice = useMemo(() => {
    const totalPool = parseFloat(market.yes_pool) + parseFloat(market.no_pool)
    
    if (side === 'YES') {
      return parseFloat(market.no_pool) / totalPool
    } else {
      return parseFloat(market.yes_pool) / totalPool
    }
  }, [market.yes_pool, market.no_pool, side])

  // =============================================
  // LÓGICA CORREGIDA: REPLICA SQL EXACTO
  // =============================================
  
  const estimatedReturn = useMemo(() => {
    if (!amount || parseFloat(amount) <= 0) return null

    const yesPool = parseFloat(market.yes_pool)
    const noPool = parseFloat(market.no_pool)
    const k = yesPool * noPool
    const totalPool = yesPool + noPool
    const FEE_RATE = 0.02

    if (mode === 'BUY') {
      // ==========================================
      // COMPRA: LÓGICA MINT & SWAP (CORREGIDA)
      // ==========================================
      const investment = parseFloat(amount)
      const fee = investment * FEE_RATE
      const investmentAfterFee = investment - fee

      // 1. MINT: Acciones base garantizadas (1 dólar = 1 acción)
      const sharesBase = investmentAfterFee

      // 2. SWAP: Vender las acciones del lado opuesto al pool (K CONSTANTE)
      let sharesFromSwap = 0
      let finalPrice = 0

      if (side === 'YES') {
        // Metes tokens NO al pool
        const newNoPool = noPool + investmentAfterFee
        const newYesPool = k / newNoPool
        sharesFromSwap = yesPool - newYesPool // Sacas tokens YES
        
        finalPrice = newNoPool / (newYesPool + newNoPool)
      } else {
        // Metes tokens YES al pool
        const newYesPool = yesPool + investmentAfterFee
        const newNoPool = k / newYesPool
        sharesFromSwap = noPool - newNoPool // Sacas tokens NO
        
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
      // ==========================================
      // VENTA: NO TOCAR (FUNCIONA PERFECTO)
      // ==========================================
      
      const sharesToSell = parseFloat(amount)
      
      let Y, N
      
      if (side === 'YES') {
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
      
      if (discriminant < 0) {
        return {
          type: 'SELL',
          error: 'La cantidad es demasiado alta para vender',
          payout: 0,
          avgPrice: 0,
          fee: 0,
          finalPrice: currentPrice,
          priceImpact: 0
        }
      }
      
      const swapAmount = (-b + Math.sqrt(discriminant)) / (2 * a)
      
      if (swapAmount < 0 || swapAmount > sharesToSell) {
        return {
          type: 'SELL',
          error: 'Error en el cálculo de venta',
          payout: 0,
          avgPrice: 0,
          fee: 0,
          finalPrice: currentPrice,
          priceImpact: 0
        }
      }
      
      const payoutBeforeFee = sharesToSell - swapAmount
      const fee = payoutBeforeFee * FEE_RATE
      const payoutAfterFee = payoutBeforeFee - fee
      
      if (payoutAfterFee <= 0) {
        return {
          type: 'SELL',
          error: 'El monto de venta es muy bajo',
          payout: 0,
          avgPrice: 0,
          fee: 0,
          finalPrice: currentPrice,
          priceImpact: 0
        }
      }
      
      let newYesPool, newNoPool
      
      if (side === 'YES') {
        newYesPool = yesPool + swapAmount
        newNoPool = k / newYesPool
      } else {
        newNoPool = noPool + swapAmount
        newYesPool = k / newNoPool
      }
      
      const avgPrice = payoutAfterFee / sharesToSell
      const newTotalPool = newYesPool + newNoPool
      const finalPrice = side === 'YES' 
        ? newNoPool / newTotalPool 
        : newYesPool / newTotalPool
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
  }, [amount, market.yes_pool, market.no_pool, side, mode, currentPrice])

  const calculateMaxPrice = useCallback(() => {
    const tolerance = slippageTolerance / 100
    return Math.min(currentPrice * (1 + tolerance), 0.99)
  }, [currentPrice, slippageTolerance])

  const calculateMinPrice = useCallback(() => {
    const tolerance = slippageTolerance / 100
    return Math.max(currentPrice * (1 - tolerance), 0.01)
  }, [currentPrice, slippageTolerance])

  const handleTrade = async () => {

    const confirmMessage = mode === 'BUY' 
      ? `¿Confirmas la COMPRA de tokens ${side} por $${amount}?` 
      : `¿Confirmas la VENTA de ${amount} tokens ${side}?`;
      
    if (!window.confirm(confirmMessage)) return; // Si le da a Cancelar, no hace nada

    setError(null)
    setLoading(true)

    try {
      if (mode === 'BUY') {
        if (parseFloat(amount) > profile.balance) {
          throw new Error('Saldo insuficiente')
        }

        const maxPrice = calculateMaxPrice()

        const { data, error } = await supabase.rpc('buy_shares', {
          p_market_id: market.id,
          p_side: side,
          p_investment: parseFloat(amount),
          p_max_price: maxPrice
        })

        if (error) throw error
        
        refreshProfile()
        onClose()
        
        toast.success(
          <div className="flex flex-col gap-1">
            <span className="font-bold text-base text-gray-900">¡Compra exitosa!</span>
            <span className="text-sm text-gray-600">Recibiste: <b className="text-polygreen">{data.shares_bought.toFixed(2)}</b> tokens {side}</span>
            <span className="text-sm text-gray-600">Precio promedio: <b className="text-gray-900">{(data.price * 100).toFixed(2)}¢</b></span>
            <span className="text-sm text-gray-600">Fee pagado: <b className="text-polyred">${data.fee_paid.toFixed(2)}</b></span>
            <span className="text-xs text-gray-500 mt-2 flex items-center gap-1 font-semibold">
              ⚡ {data.daily_moves_remaining} movimientos restantes
            </span>
          </div>,
          { duration: 5000 }
        )
        // ==========================================

      } else {
        if (parseFloat(amount) > userShares) {
          throw new Error('No tienes suficientes acciones')
        }

        const minPrice = calculateMinPrice()

        const { data, error } = await supabase.rpc('sell_shares', {
          p_market_id: market.id,
          p_side: side,
          p_shares_to_sell: parseFloat(amount),
          p_min_price: minPrice
        })

        if (error) throw error
        
        refreshProfile()
        onClose()
        
        toast.success(
          <div className="flex flex-col gap-1">
            <span className="font-bold text-base text-gray-900">¡Venta exitosa!</span>
            <span className="text-sm text-gray-600">Vendiste: <b className="text-gray-900">{data.shares_sold.toFixed(2)}</b> tokens {side}</span>
            <span className="text-sm text-gray-600">Recibiste: <b className="text-polygreen">${data.payout.toFixed(2)}</b></span>
            <span className="text-sm text-gray-600">Fee pagado: <b className="text-polyred">${data.fee_paid.toFixed(2)}</b></span>
            <span className="text-xs text-gray-500 mt-2 flex items-center gap-1 font-semibold">
              ⚡ {data.daily_moves_remaining} movimientos restantes
            </span>
          </div>,
          { duration: 5000 }
        )
        // ==========================================

      }
    } catch (error) {
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto scrollable-container"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {mode === 'BUY' ? 'Comprar' : 'Vender'} {side}
            </h2>
            {dailyMovesRemaining !== null && (
              <div className="flex items-center gap-1.5 mt-1">
                <Zap size={14} className={dailyMovesRemaining <= 5 ? 'text-red-500' : 'text-polyblue'} />
                <span className={`text-xs font-semibold ${dailyMovesRemaining <= 5 ? 'text-red-600' : 'text-gray-600'}`}>
                  {dailyMovesRemaining} movimientos restantes hoy
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors tap-feedback no-select"
            aria-label="Cerrar"
          >
            <X size={24} className="text-gray-600" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <p className="font-medium text-gray-900 leading-snug">{market.question}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setMode('BUY')}
              className={`py-2.5 rounded-md font-semibold transition-all tap-feedback no-select ${
                mode === 'BUY' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'
              }`}
            >
              Comprar
            </button>
            <button
              onClick={() => setMode('SELL')}
              className={`py-2.5 rounded-md font-semibold transition-all tap-feedback no-select ${
                mode === 'SELL' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'
              }`}
            >
              Vender
            </button>
          </div>

          <div className={`rounded-xl p-4 border-2 ${
            side === 'YES' ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Precio Actual</span>
              <div className="text-right">
                <div className={`text-3xl font-bold ${
                  side === 'YES' ? 'text-polygreen' : 'text-polyred'
                }`}>
                  {(currentPrice * 100).toFixed(1)}¢
                </div>
                <div className="text-sm text-gray-600 mt-0.5">
                  {(currentPrice * 100).toFixed(1)}% probabilidad
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {mode === 'BUY' ? 'Cantidad a invertir (USD)' : 'Tokens a vender'}
            </label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-xl font-semibold pointer-events-none">
                {mode === 'BUY' ? '$' : ''}
              </div>
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                max={mode === 'BUY' ? profile?.balance : userShares}
                className="w-full pl-9 pr-4 py-4 text-2xl font-semibold rounded-xl border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition"
                style={{ fontSize: '24px' }}
                autoComplete="off"
              />
            </div>

            <div className="flex justify-between items-center mt-2.5 text-sm">
              <span className="text-gray-600">
                {mode === 'BUY' ? 'Saldo disponible:' : 'Acciones disponibles:'}
              </span>
              <button
                onClick={() => setAmount(mode === 'BUY' ? profile?.balance.toString() : userShares.toString())}
                className="font-semibold text-polyblue hover:underline tap-feedback"
              >
                {mode === 'BUY'
                  ? `$${profile?.balance.toFixed(2)}`
                  : `${userShares.toFixed(2)} tokens`
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
                {mode === 'BUY' ? (
                  <>
                    <div className="flex justify-between items-center py-2 border-b border-blue-200">
                      <span className="text-gray-700 font-medium">Recibirás:</span>
                      <span className="font-bold text-gray-900 text-base">
                        {estimatedReturn.shares.toFixed(2)} tokens de {side}
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
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-gray-700">Nuevo precio {side}:</span>
                        <span className="font-bold text-polyblue text-base">
                          {(estimatedReturn.finalPrice * 100).toFixed(2)}¢
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-700 text-xs">Price Impact:</span>
                        <span className={`font-bold text-xs ${
                          estimatedReturn.priceImpact > 0 ? 'text-red-600' : 'text-green-600'
                        }`}>
                          {estimatedReturn.priceImpact > 0 ? '+' : ''}{estimatedReturn.priceImpact.toFixed(2)}%
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
                    <div className="pt-2 mt-2 border-t border-blue-200">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-gray-700">Nuevo precio {side}:</span>
                        <span className="font-bold text-polyblue text-base">
                          {(estimatedReturn.finalPrice * 100).toFixed(2)}¢
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-700 text-xs">Price Impact:</span>
                        <span className={`font-bold text-xs ${
                          estimatedReturn.priceImpact < 0 ? 'text-red-600' : 'text-green-600'
                        }`}>
                          {estimatedReturn.priceImpact > 0 ? '+' : ''}{estimatedReturn.priceImpact.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {estimatedReturn?.error && (
            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-yellow-900 font-semibold text-sm mb-1">Advertencia</p>
                <p className="text-yellow-800 text-sm">{estimatedReturn.error}</p>
              </div>
            </div>
          )}

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
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
              className="w-full accent-polyblue"
              style={{ touchAction: 'none' }}
            />
            <div className="text-xs text-gray-600 mt-2">
              {mode === 'BUY' ? (
                <p>Precio máximo aceptado: <strong className="text-gray-900">{(calculateMaxPrice() * 100).toFixed(2)}¢</strong></p>
              ) : (
                <p>Precio mínimo aceptado: <strong className="text-gray-900">{(calculateMinPrice() * 100).toFixed(2)}¢</strong></p>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-red-900 font-semibold text-sm mb-1">Error</p>
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            </div>
          )}

          {dailyMovesRemaining !== null && dailyMovesRemaining <= 5 && dailyMovesRemaining > 0 && (
            <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-3 flex items-start gap-2">
              <AlertCircle size={18} className="text-orange-600 flex-shrink-0 mt-0.5" />
              <p className="text-orange-900 text-xs flex-1">
                <strong>Cuidado:</strong> Solo te quedan {dailyMovesRemaining} movimientos hoy. Úsalos sabiamente.
              </p>
            </div>
          )}

          <button
            onClick={handleTrade}
            disabled={
              loading || 
              !amount || 
              parseFloat(amount) <= 0 || 
              dailyMovesRemaining === 0 || 
              estimatedReturn?.error
            }
            className={`w-full py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg no-select ${
              mode === 'BUY'
                ? side === 'YES'
                  ? 'bg-polygreen hover:bg-green-700 active:bg-green-800 text-white shadow-green-500/30'
                  : 'bg-polyred hover:bg-red-700 active:bg-red-800 text-white shadow-red-500/30'
                : 'bg-gray-900 hover:bg-gray-800 active:bg-gray-950 text-white shadow-gray-500/30'
            }`}
          >
            {loading
              ? 'Procesando...'
              : dailyMovesRemaining === 0
              ? 'Sin movimientos disponibles hoy'
              : estimatedReturn?.error
              ? 'Cantidad inválida'
              : mode === 'BUY'
              ? `Comprar ${side}`
              : `Vender ${side}`
            }
          </button>
        </div>
      </div>
    </div>
  )
}