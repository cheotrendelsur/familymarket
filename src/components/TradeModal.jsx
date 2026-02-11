import { useState, useEffect } from 'react'
import { X, TrendingUp, TrendingDown, AlertCircle, Zap } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'

export default function TradeModal({ market, side, onClose }) {
  const { profile, refreshProfile } = useAuth()
  const [mode, setMode] = useState('BUY') // 'BUY' or 'SELL'
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [userShares, setUserShares] = useState(0)
  const [slippageTolerance, setSlippageTolerance] = useState(5) // Default 5%
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
      const { data, error } = await supabase
        .from('transaction_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .gte('created_at', new Date().toISOString().split('T')[0])
        .in('action', ['BUY', 'SELL'])

      if (error) throw error
      setDailyMovesRemaining(25 - (data || 0))
    } catch (error) {
      console.error('Error al obtener movimientos diarios:', error)
      setDailyMovesRemaining(25)
    }
  }

  const calculatePrice = () => {
    const totalPool = parseFloat(market.yes_pool) + parseFloat(market.no_pool)
    const pool = side === 'YES' ? parseFloat(market.yes_pool) : parseFloat(market.no_pool)
    return pool / totalPool
  }

  const calculateMaxPrice = () => {
    const currentPrice = calculatePrice()
    const tolerance = slippageTolerance / 100
    return currentPrice * (1 + tolerance)
  }

  const calculateMinPrice = () => {
    const currentPrice = calculatePrice()
    const tolerance = slippageTolerance / 100
    return currentPrice * (1 - tolerance)
  }

  const handleTrade = async () => {
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
        
        alert(`✅ Compra exitosa!\n\nAdquiriste: ${data.shares_bought.toFixed(2)} acciones de ${side}\nPrecio: ${(data.price * 100).toFixed(2)}¢\nMovimientos restantes hoy: ${data.daily_moves_remaining}`)
      } else {
        // SELL
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
        
        alert(`✅ Venta exitosa!\n\nVendiste: ${data.shares_sold.toFixed(2)} acciones\nRecibiste: $${data.payout.toFixed(2)}\nMovimientos restantes hoy: ${data.daily_moves_remaining}`)
      }
    } catch (error) {
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const price = calculatePrice()

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
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
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={24} className="text-gray-600" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Market Question */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <p className="font-medium text-gray-900 leading-snug">{market.question}</p>
          </div>

          {/* Mode Toggle */}
          <div className="grid grid-cols-2 gap-2 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setMode('BUY')}
              className={`py-2.5 rounded-md font-semibold transition-all ${
                mode === 'BUY'
                  ? 'bg-white shadow-sm text-gray-900'
                  : 'text-gray-600'
              }`}
            >
              Comprar
            </button>
            <button
              onClick={() => setMode('SELL')}
              className={`py-2.5 rounded-md font-semibold transition-all ${
                mode === 'SELL'
                  ? 'bg-white shadow-sm text-gray-900'
                  : 'text-gray-600'
              }`}
            >
              Vender
            </button>
          </div>

          {/* Current Price */}
          <div className={`rounded-xl p-4 border-2 ${
            side === 'YES'
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-rose-50 border-rose-200'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Precio Actual</span>
              <div className="text-right">
                <div className={`text-3xl font-bold ${
                  side === 'YES' ? 'text-polygreen' : 'text-polyred'
                }`}>
                  {(price * 100).toFixed(1)}¢
                </div>
                <div className="text-sm text-gray-600 mt-0.5">
                  {(price * 100).toFixed(0)}% probabilidad
                </div>
              </div>
            </div>
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
              {mode === 'BUY' ? (
                <p>Precio máximo aceptado: <strong>{(calculateMaxPrice() * 100).toFixed(2)}¢</strong></p>
              ) : (
                <p>Precio mínimo aceptado: <strong>{(calculateMinPrice() * 100).toFixed(2)}¢</strong></p>
              )}
            </div>
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {mode === 'BUY' ? 'Cantidad a invertir' : 'Acciones a vender'}
            </label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-xl font-semibold">
                {mode === 'BUY' ? '$' : ''}
              </div>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                max={mode === 'BUY' ? profile?.balance : userShares}
                className="w-full pl-9 pr-4 py-4 text-2xl font-semibold rounded-xl border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition"
              />
            </div>

            <div className="flex justify-between items-center mt-2.5 text-sm">
              <span className="text-gray-600">
                {mode === 'BUY' ? 'Saldo disponible:' : 'Acciones disponibles:'}
              </span>
              <button
                onClick={() => setAmount(mode === 'BUY' ? profile?.balance.toString() : userShares.toString())}
                className="font-semibold text-polyblue hover:underline"
              >
                {mode === 'BUY'
                  ? `$${profile?.balance.toFixed(2)}`
                  : `${userShares.toFixed(2)} acciones`
                }
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-red-700 text-sm flex-1">
                {error}
              </div>
            </div>
          )}

          {/* Warning if low moves */}
          {dailyMovesRemaining !== null && dailyMovesRemaining <= 5 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle size={18} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-yellow-800 text-xs flex-1">
                <strong>Advertencia:</strong> Solo te quedan {dailyMovesRemaining} movimientos hoy. Usa tus operaciones sabiamente.
              </p>
            </div>
          )}

          {/* Action Button */}
          <button
            onClick={handleTrade}
            disabled={loading || !amount || parseFloat(amount) <= 0 || dailyMovesRemaining === 0}
            className={`w-full py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              mode === 'BUY'
                ? side === 'YES'
                  ? 'bg-polygreen hover:bg-green-700 active:bg-green-800 text-white shadow-lg shadow-green-500/20'
                  : 'bg-polyred hover:bg-red-700 active:bg-red-800 text-white shadow-lg shadow-red-500/20'
                : 'bg-gray-900 hover:bg-gray-800 active:bg-gray-950 text-white shadow-lg shadow-gray-500/20'
            }`}
          >
            {loading
              ? 'Procesando...'
              : dailyMovesRemaining === 0
              ? 'Sin movimientos disponibles'
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