import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { TrendingUp, RefreshCw, Trophy, Medal, Award, CheckCircle, XCircle } from 'lucide-react'
import MarketCard from '../components/MarketCard'
import TradeModal from '../components/TradeModal'

export default function HomePage({ setIsModalOpen }) {
  const [activeMarkets, setActiveMarkets] = useState([])
  const [closedMarkets, setClosedMarkets] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedMarket, setSelectedMarket] = useState(null)
  const [tradeSide, setTradeSide] = useState(null)

  useEffect(() => {
    fetchAllData()

    // Suscripción Realtime solo a transacciones para actualizar ranking
    const channel = supabase
      .channel('homepage-changes')
      .on(
        'postgres_changes',
        { 
          event: '*', 
          schema: 'public', 
          table: 'transaction_logs' 
        },
        () => {
          fetchLeaderboard()
        }
      )
      .on(
        'postgres_changes',
        { 
          event: '*', 
          schema: 'public', 
          table: 'markets' 
        },
        () => {
          fetchMarkets()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // Notificar al padre cuando el modal se abre/cierra
  useEffect(() => {
    if (setIsModalOpen) {
      setIsModalOpen(selectedMarket !== null && tradeSide !== null)
    }
  }, [selectedMarket, tradeSide, setIsModalOpen])

  const fetchAllData = async () => {
    await Promise.all([fetchMarkets(), fetchLeaderboard()])
    setLoading(false)
  }

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
    } catch (error) {
      console.error('Error al obtener mercados:', error)
    } finally {
      setRefreshing(false)
    }
  }

  const fetchLeaderboard = async () => {
    try {
      // 1. Obtener todos los perfiles con username
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, username, balance, email')
        .not('username', 'is', null)

      if (profilesError) throw profilesError

      // 2. Obtener todas las acciones de estos usuarios
      const { data: shares, error: sharesError } = await supabase
        .from('shares')
        .select(`
          user_id,
          market_id,
          side,
          count,
          markets (yes_pool, no_pool, closed, outcome)
        `)
        .gt('count', 0)

      if (sharesError) throw sharesError

      // 3. Calcular patrimonio total de cada usuario
      const userNetWorth = profiles.map(profile => {
        const cash = parseFloat(profile.balance)
        
        // Calcular valor de acciones
        const userShares = shares?.filter(s => s.user_id === profile.id) || []
        const sharesValue = userShares.reduce((total, share) => {
          const market = share.markets
          if (!market) return total

          let shareValue = 0
          
          if (market.closed) {
            // Mercado cerrado: acciones ganadoras valen $1, perdedoras $0
            if (share.side === market.outcome) {
              shareValue = parseFloat(share.count) * 1.0
            }
          } else {
            // Mercado activo: calcular valor según precio actual
            const totalPool = parseFloat(market.yes_pool) + parseFloat(market.no_pool)
            const pool = share.side === 'YES' ? parseFloat(market.yes_pool) : parseFloat(market.no_pool)
            const currentPrice = pool / totalPool
            shareValue = parseFloat(share.count) * currentPrice
          }

          return total + shareValue
        }, 0)

        return {
          userId: profile.id,
          username: profile.username || profile.email.split('@')[0],
          cash,
          sharesValue,
          totalNetWorth: cash + sharesValue
        }
      })

      // 4. Ordenar por patrimonio total
      userNetWorth.sort((a, b) => b.totalNetWorth - a.totalNetWorth)

      setLeaderboard(userNetWorth)
    } catch (error) {
      console.error('Error al obtener leaderboard:', error)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchAllData()
  }

  const handleTradeClick = (market, side) => {
    setSelectedMarket(market)
    setTradeSide(side)
  }

  const handleCloseModal = () => {
    setSelectedMarket(null)
    setTradeSide(null)
    fetchMarkets()
  }

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

  return (
    <div className="min-h-screen-safe bg-polygray-bg pb-6">
      {/* ============================================= */}
      {/* SECCIÓN 1: MERCADOS ACTIVOS */}
      {/* ============================================= */}
      <div className="bg-white border-b border-gray-200 mb-6">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Mercados Activos</h2>
              <p className="text-sm text-gray-600 mt-1">
                Compra y vende acciones de eventos futuros
              </p>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors active:bg-gray-200 disabled:opacity-50"
              aria-label="Refrescar mercados"
            >
              <RefreshCw 
                size={20} 
                className={`text-gray-600 ${refreshing ? 'animate-spin' : ''}`}
                strokeWidth={2}
              />
            </button>
          </div>

          {activeMarkets.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-200">
              <TrendingUp size={48} className="mx-auto text-gray-400 mb-3" strokeWidth={1.5} />
              <p className="text-gray-600">No hay mercados activos en este momento</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeMarkets.map((market) => (
                <MarketCard
                  key={market.id}
                  market={market}
                  onClickYes={(m) => handleTradeClick(m, 'YES')}
                  onClickNo={(m) => handleTradeClick(m, 'NO')}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ============================================= */}
      {/* SECCIÓN 2: MERCADOS FINALIZADOS */}
      {/* ============================================= */}
      <div className="max-w-7xl mx-auto px-4 mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Mercados Finalizados</h2>
        
        {closedMarkets.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
            <p className="text-gray-500">Aún no hay mercados finalizados</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {closedMarkets.map((market) => {
              const totalPool = parseFloat(market.yes_pool) + parseFloat(market.no_pool)
              const yesPrice = (parseFloat(market.yes_pool) / totalPool * 100).toFixed(1)
              const noPrice = (parseFloat(market.no_pool) / totalPool * 100).toFixed(1)

              return (
                <div
                  key={market.id}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden opacity-80 hover:opacity-100 transition-opacity"
                >
                  <div className="p-4">
                    {/* Header */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <TrendingUp size={20} className="text-gray-400" strokeWidth={2} />
                      </div>
                      <h3 className="font-semibold text-gray-700 leading-snug flex-1">
                        {market.question}
                      </h3>
                    </div>

                    {/* Winner Badge */}
                    <div className={`rounded-xl p-4 border-2 mb-3 ${
                      market.outcome === 'YES'
                        ? 'bg-emerald-50 border-emerald-300'
                        : 'bg-rose-50 border-rose-300'
                    }`}>
                      <div className="flex items-center justify-center gap-2">
                        {market.outcome === 'YES' ? (
                          <CheckCircle size={24} className="text-polygreen" strokeWidth={2.5} />
                        ) : (
                          <XCircle size={24} className="text-polyred" strokeWidth={2.5} />
                        )}
                        <span className={`text-2xl font-bold ${
                          market.outcome === 'YES' ? 'text-polygreen' : 'text-polyred'
                        }`}>
                          GANÓ {market.outcome}
                        </span>
                      </div>
                    </div>

                    {/* Final Prices */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="text-center">
                        <div className="text-gray-500">Precio Final YES</div>
                        <div className="font-bold text-polygreen">{yesPrice}¢</div>
                      </div>
                      <div className="text-center">
                        <div className="text-gray-500">Precio Final NO</div>
                        <div className="font-bold text-polyred">{noPrice}¢</div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ============================================= */}
      {/* SECCIÓN 3: RANKING FAMILIAR */}
      {/* ============================================= */}
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center gap-3 mb-4">
          <Trophy size={28} className="text-yellow-500" strokeWidth={2} />
          <h2 className="text-2xl font-bold text-gray-900">Ranking Familiar</h2>
        </div>

        {leaderboard.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
            <p className="text-gray-500">El ranking aparecerá cuando los usuarios configuren su nombre</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                      Posición
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                      Jugador
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                      Efectivo
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                      En Acciones
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                      Patrimonio Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {leaderboard.map((user, index) => {
                    const position = index + 1
                    let PositionIcon = null
                    let iconColor = ''

                    if (position === 1) {
                      PositionIcon = Trophy
                      iconColor = 'text-yellow-500'
                    } else if (position === 2) {
                      PositionIcon = Medal
                      iconColor = 'text-gray-400'
                    } else if (position === 3) {
                      PositionIcon = Award
                      iconColor = 'text-amber-600'
                    }

                    return (
                      <tr 
                        key={user.userId}
                        className={`hover:bg-gray-50 transition-colors ${
                          position === 1 ? 'bg-yellow-50' : ''
                        }`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {PositionIcon ? (
                              <PositionIcon size={20} className={iconColor} strokeWidth={2} />
                            ) : (
                              <span className="text-sm font-bold text-gray-500 w-5 text-center">
                                #{position}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`font-bold ${
                            position === 1 ? 'text-yellow-700 text-lg' : 'text-gray-900'
                          }`}>
                            {user.username}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <span className="text-sm text-gray-600">
                            ${user.cash.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <span className="text-sm text-gray-600">
                            ${user.sharesValue.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <span className={`font-bold text-lg ${
                            position === 1 ? 'text-yellow-600' : 'text-gray-900'
                          }`}>
                            ${user.totalNetWorth.toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Trade Modal */}
      {selectedMarket && tradeSide && (
        <TradeModal
          market={selectedMarket}
          side={tradeSide}
          onClose={handleCloseModal}
        />
      )}
    </div>
  )
}