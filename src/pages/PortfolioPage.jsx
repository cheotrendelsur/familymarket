import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { TrendingUp, TrendingDown, DollarSign, Briefcase, Zap, CheckCircle, XCircle } from 'lucide-react'

export default function PortfolioPage() {
  const { profile } = useAuth()
  const [activePositions, setActivePositions] = useState([])
  const [closedPositions, setClosedPositions] = useState([])
  const [loading, setLoading] = useState(true)
  const [totalValue, setTotalValue] = useState(0)
  const [dailyMovesRemaining, setDailyMovesRemaining] = useState(null)

  useEffect(() => {
    fetchPortfolio()
    fetchDailyMoves()
  }, [profile])

  const fetchDailyMoves = async () => {
    try {
      const { count, error } = await supabase
        .from('transaction_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .gte('created_at', new Date().toISOString().split('T')[0])
        .in('action', ['BUY', 'SELL'])

      if (error) throw error
      setDailyMovesRemaining(25 - (count || 0))
    } catch (error) {
      console.error('Error al obtener movimientos diarios:', error)
      setDailyMovesRemaining(25)
    }
  }

  const fetchPortfolio = async () => {
    if (!profile) return

    try {
      // Obtener acciones del usuario
      const { data: sharesData, error: sharesError } = await supabase
        .from('shares')
        .select(`
          *,
          markets (*)
        `)
        .eq('user_id', profile.id)
        .gt('count', 0)

      if (sharesError) throw sharesError

      // Obtener transacciones para calcular costo promedio
      const { data: transactionsData, error: transError } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', profile.id)
        .in('type', ['BUY', 'SELL'])

      if (transError) throw transError

      // Separar posiciones activas y cerradas
      const active = []
      const closed = []
      let portfolioValue = parseFloat(profile.balance)

      sharesData?.forEach(share => {
        const market = share.markets
        const key = `${market.id}-${share.side}`

        // Calcular valor actual
        const totalPool = parseFloat(market.yes_pool) + parseFloat(market.no_pool)
        const pool = share.side === 'YES' ? parseFloat(market.no_pool) : parseFloat(market.yes_pool)
        const currentPrice = pool / totalPool

        // Calcular costo promedio
        const relevantTxs = transactionsData?.filter(
          tx => tx.market_id === market.id && tx.side === share.side
        ) || []

        let totalCost = 0
        let totalShares = 0

        relevantTxs.forEach(tx => {
          if (tx.type === 'BUY') {
            totalCost += parseFloat(tx.total_cost)
            totalShares += parseFloat(tx.shares_amount)
          } else if (tx.type === 'SELL') {
            const sellRatio = parseFloat(tx.shares_amount) / totalShares
            totalCost -= totalCost * sellRatio
            totalShares -= parseFloat(tx.shares_amount)
          }
        })

        const avgCost = totalShares > 0 ? totalCost / totalShares : 0
        const shares = parseFloat(share.count)
        
        let currentValue, costBasis, pnl, pnlPercent

        if (market.closed) {
          // Mercado cerrado: valor definitivo
          if (share.side === market.outcome) {
            currentValue = shares * 1.0 // Ganadores valen $1
          } else {
            currentValue = 0 // Perdedores valen $0
          }
          costBasis = shares * avgCost
          pnl = currentValue - costBasis
          pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0

          closed.push({
            market,
            side: share.side,
            shares,
            avgCost,
            currentPrice: share.side === market.outcome ? 1.0 : 0,
            currentValue,
            costBasis,
            pnl,
            pnlPercent,
            isWinner: share.side === market.outcome
          })
        } else {
          // Mercado activo
          currentValue = shares * currentPrice
          costBasis = shares * avgCost
          pnl = currentValue - costBasis
          pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0

          active.push({
            market,
            side: share.side,
            shares,
            avgCost,
            currentPrice,
            currentValue,
            costBasis,
            pnl,
            pnlPercent
          })

          portfolioValue += currentValue
        }
      })

      setActivePositions(active)
      setClosedPositions(closed)
      setTotalValue(portfolioValue)

    } catch (error) {
      console.error('Error al obtener portafolio:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen-safe">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-polyblue mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Cargando portafolio...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen-safe bg-polygray-bg px-4 py-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* ============================================= */}
        {/* HEADER: VALOR TOTAL + CONTADOR DE VIDAS */}
        {/* ============================================= */}
        <div className="bg-gradient-to-br from-polyblue to-blue-600 rounded-2xl p-6 text-white shadow-xl">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              <DollarSign size={20} strokeWidth={2.5} />
              <span className="text-sm font-semibold opacity-90">Valor Total de la Cuenta</span>
            </div>
            
            {/* Contador de Vidas */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-bold text-sm ${
              dailyMovesRemaining !== null && dailyMovesRemaining <= 5
                ? 'bg-red-500 bg-opacity-20 border-2 border-red-300'
                : 'bg-white bg-opacity-20 border-2 border-white border-opacity-30'
            }`}>
              <Zap size={16} strokeWidth={2.5} />
              <span>
                {dailyMovesRemaining !== null ? dailyMovesRemaining : '...'}/25
              </span>
            </div>
          </div>
          
          <div className="text-5xl font-bold mb-4">
            ${totalValue.toFixed(2)}
          </div>
          
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white border-opacity-20">
            <div>
              <div className="text-xs opacity-75 mb-1">Efectivo Disponible</div>
              <div className="text-xl font-bold">${profile?.balance.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-xs opacity-75 mb-1">En Acciones Activas</div>
              <div className="text-xl font-bold">
                ${(totalValue - parseFloat(profile?.balance || 0)).toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        {/* ============================================= */}
        {/* TABLA 1: POSICIONES ACTIVAS */}
        {/* ============================================= */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <Briefcase size={24} className="text-gray-700" strokeWidth={2} />
            <h2 className="text-2xl font-bold text-gray-900">Posiciones Activas</h2>
          </div>

          {activePositions.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
              <TrendingUp size={64} className="mx-auto text-gray-400 mb-4" strokeWidth={1.5} />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                No tienes posiciones activas
              </h3>
              <p className="text-gray-600">
                Compra acciones en la pestaña Home para empezar a operar
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activePositions.map((position, index) => (
                <div
                  key={index}
                  className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow"
                >
                  {/* Market Question */}
                  <div className="mb-4">
                    <h3 className="font-bold text-gray-900 leading-snug mb-2">
                      {position.market.question}
                    </h3>
                    <div className={`inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-bold ${
                      position.side === 'YES'
                        ? 'bg-emerald-100 text-polygreen'
                        : 'bg-rose-100 text-polyred'
                    }`}>
                      {position.side} • {position.shares.toFixed(2)} acciones
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <div className="text-gray-500 text-xs font-medium mb-1">Costo Prom.</div>
                      <div className="font-bold text-gray-900 text-lg">
                        {(position.avgCost * 100).toFixed(1)}¢
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs font-medium mb-1">Precio Actual</div>
                      <div className="font-bold text-gray-900 text-lg">
                        {(position.currentPrice * 100).toFixed(1)}¢
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs font-medium mb-1">Valor Total</div>
                      <div className="font-bold text-gray-900 text-lg">
                        ${position.currentValue.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* P/L Section */}
                  <div className="pt-4 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-600">P/L No Realizado</span>
                      <div className={`flex items-center gap-2 font-bold text-lg ${
                        position.pnl >= 0 ? 'text-polygreen' : 'text-polyred'
                      }`}>
                        {position.pnl >= 0 ? (
                          <TrendingUp size={20} strokeWidth={2.5} />
                        ) : (
                          <TrendingDown size={20} strokeWidth={2.5} />
                        )}
                        <span>
                          {position.pnl >= 0 ? '+' : ''}${position.pnl.toFixed(2)}
                        </span>
                        <span className="text-sm font-semibold">
                          ({position.pnl >= 0 ? '+' : ''}{position.pnlPercent.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ============================================= */}
        {/* TABLA 2: HISTORIAL DE RESULTADOS (CERRADOS) */}
        {/* ============================================= */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle size={24} className="text-gray-700" strokeWidth={2} />
            <h2 className="text-2xl font-bold text-gray-900">Historial de Resultados</h2>
          </div>

          {closedPositions.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-600">
                Aún no tienes resultados de mercados finalizados
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {closedPositions.map((position, index) => (
                <div
                  key={index}
                  className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm opacity-90"
                >
                  {/* Market Question */}
                  <div className="mb-4">
                    <h3 className="font-bold text-gray-700 leading-snug mb-2">
                      {position.market.question}
                    </h3>
                    <div className="flex items-center gap-2">
                      <div className={`inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-bold ${
                        position.side === 'YES'
                          ? 'bg-emerald-100 text-polygreen'
                          : 'bg-rose-100 text-polyred'
                      }`}>
                        {position.side} • {position.shares.toFixed(2)} acciones
                      </div>
                      {position.isWinner ? (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold bg-green-100 text-green-700 border-2 border-green-300">
                          <CheckCircle size={14} />
                          GANASTE
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold bg-gray-100 text-gray-600 border-2 border-gray-300">
                          <XCircle size={14} />
                          PERDISTE
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <div className="text-gray-500 text-xs font-medium mb-1">Invertido</div>
                      <div className="font-bold text-gray-900 text-lg">
                        ${position.costBasis.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs font-medium mb-1">Valor Final</div>
                      <div className="font-bold text-gray-900 text-lg">
                        ${position.currentValue.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs font-medium mb-1">Resultado</div>
                      <div className={`font-bold text-lg ${
                        position.pnl >= 0 ? 'text-polygreen' : 'text-polyred'
                      }`}>
                        {position.pnl >= 0 ? '+' : ''}${position.pnl.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* P/L Realizado */}
                  <div className="pt-4 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-600">P/L Realizado</span>
                      <div className={`flex items-center gap-2 font-bold text-lg ${
                        position.pnl >= 0 ? 'text-polygreen' : 'text-polyred'
                      }`}>
                        {position.pnl >= 0 ? (
                          <TrendingUp size={20} strokeWidth={2.5} />
                        ) : (
                          <TrendingDown size={20} strokeWidth={2.5} />
                        )}
                        <span>
                          {position.pnl >= 0 ? '+' : ''}${position.pnl.toFixed(2)}
                        </span>
                        <span className="text-sm font-semibold">
                          ({position.pnl >= 0 ? '+' : ''}{position.pnlPercent.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}