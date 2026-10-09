import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle, RefreshCw, TrendingUp, Trophy, XCircle } from 'lucide-react'
import { rpc } from '../lib/api'
import { groupMarkets } from '../lib/markets'
import { noPrice, yesPrice } from '../lib/trading'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { usePolling } from '../hooks/usePolling'
import { useToggleSet } from '../hooks/useToggleSet'
import MarketCard from '../components/MarketCard'
import TradeModal from '../components/TradeModal'
import GroupAccordion from '../components/GroupAccordion'
import Leaderboard from '../components/Leaderboard'
import PageLoader from '../components/PageLoader'

function ClosedCard({ market }) {
  const won = market.outcome === 'YES'
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden opacity-90 hover:opacity-100 transition-opacity">
      <div className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <TrendingUp size={20} className="text-gray-400" strokeWidth={2} />
          </div>
          <h3 className="font-semibold text-gray-700 leading-snug flex-1">{market.question}</h3>
        </div>
        <div className={`rounded-xl p-3 border-2 mb-3 ${won ? 'bg-emerald-50 border-emerald-300' : 'bg-rose-50 border-rose-300'}`}>
          <div className="flex items-center justify-center gap-2">
            {won ? (
              <CheckCircle size={22} className="text-polygreen" strokeWidth={2.5} />
            ) : (
              <XCircle size={22} className="text-polyred" strokeWidth={2.5} />
            )}
            <span className={`text-xl font-bold ${won ? 'text-polygreen' : 'text-polyred'}`}>GANÓ {market.outcome}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-center">
          <div>
            <div className="text-gray-500">Precio final YES</div>
            <div className="font-bold text-polygreen">{(yesPrice(market) * 100).toFixed(1)}¢</div>
          </div>
          <div>
            <div className="text-gray-500">Precio final NO</div>
            <div className="font-bold text-polyred">{(noPrice(market) * 100).toFixed(1)}¢</div>
          </div>
        </div>
      </div>
    </div>
  )
}

const Grid = ({ children }) => <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>

export default function HomePage({ setIsModalOpen }) {
  const { profile } = useAuth()
  const { activeMarkets, closedMarkets, marketsLoaded, refreshMarkets } = useGame()
  const [leaderboard, setLeaderboard] = useState([])
  const [leaderboardLoaded, setLeaderboardLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selection, setSelection] = useState(null) // { marketId, side }
  const [openActive, toggleActive] = useToggleSet()
  const [openClosed, toggleClosed] = useToggleSet()

  const fetchLeaderboard = useCallback(async () => {
    const data = await rpc('get_leaderboard')
    setLeaderboard(data || [])
    setLeaderboardLoaded(true)
  }, [])
  const { refresh: refreshLeaderboard } = usePolling(fetchLeaderboard, { interval: 30000 })

  // El modal lee el mercado EN VIVO desde el contexto (precios siempre actualizados).
  const selectedMarket = useMemo(
    () => (selection ? activeMarkets.find((m) => m.id === selection.marketId) || null : null),
    [selection, activeMarkets]
  )

  useEffect(() => {
    setIsModalOpen?.(!!selectedMarket)
    return () => setIsModalOpen?.(false)
  }, [selectedMarket, setIsModalOpen])

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.allSettled([refreshMarkets(), refreshLeaderboard()])
    setRefreshing(false)
  }

  const handleTrade = useCallback((market, side) => setSelection({ marketId: market.id, side }), [])
  const handleClose = useCallback(() => {
    setSelection(null)
    refreshLeaderboard()
  }, [refreshLeaderboard])

  const active = useMemo(() => groupMarkets(activeMarkets), [activeMarkets])
  const closed = useMemo(() => groupMarkets(closedMarkets), [closedMarkets])

  if (!marketsLoaded) return <PageLoader label="Cargando mercados..." />

  return (
    <div className="min-h-screen-safe bg-polygray-bg pb-6">
      <div className="bg-white border-b border-gray-200 mb-6">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Mercados Activos</h2>
              <p className="text-sm text-gray-600 mt-1">Compra y vende acciones de eventos futuros</p>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
              aria-label="Refrescar mercados"
            >
              <RefreshCw size={20} className={`text-gray-600 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={2} />
            </button>
          </div>

          {activeMarkets.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-200">
              <TrendingUp size={48} className="mx-auto text-gray-400 mb-3" strokeWidth={1.5} />
              <p className="text-gray-600">No hay mercados activos en este momento</p>
              <p className="text-xs text-gray-400 mt-1">Cuando el administrador cree uno, aparecerá aquí al instante.</p>
            </div>
          ) : (
            <div className="space-y-8">
              {active.particular.length > 0 && (
                <div>
                  <h3 className="text-lg font-bold text-gray-800 mb-4 border-b border-gray-200 pb-2">Mercados Particulares</h3>
                  <Grid>
                    {active.particular.map((m) => (
                      <MarketCard key={m.id} market={m} onTrade={handleTrade} />
                    ))}
                  </Grid>
                </div>
              )}
              {active.groups.length > 0 && (
                <div>
                  <h3 className="text-lg font-bold text-gray-800 mb-4 border-b border-gray-200 pb-2">Mercados Múltiples</h3>
                  <div className="space-y-4">
                    {active.groups.map(([topic, list]) => (
                      <GroupAccordion
                        key={topic}
                        topic={topic}
                        count={list.length}
                        open={!!openActive[topic]}
                        onToggle={() => toggleActive(topic)}
                      >
                        <Grid>
                          {list.map((m) => (
                            <MarketCard key={m.id} market={m} onTrade={handleTrade} />
                          ))}
                        </Grid>
                      </GroupAccordion>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Mercados Finalizados</h2>
        {closedMarkets.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
            <p className="text-gray-500">Aún no hay mercados finalizados</p>
          </div>
        ) : (
          <div className="space-y-8">
            {closed.particular.length > 0 && (
              <Grid>
                {closed.particular.map((m) => (
                  <ClosedCard key={m.id} market={m} />
                ))}
              </Grid>
            )}
            {closed.groups.length > 0 && (
              <div className="space-y-4">
                {closed.groups.map(([topic, list]) => (
                  <GroupAccordion
                    key={topic}
                    topic={topic}
                    count={list.length}
                    tone="gray"
                    hintOpen="Ocultar resultados"
                    hintClosed="Toca para ver resultados"
                    open={!!openClosed[topic]}
                    onToggle={() => toggleClosed(topic)}
                  >
                    <Grid>
                      {list.map((m) => (
                        <ClosedCard key={m.id} market={m} />
                      ))}
                    </Grid>
                  </GroupAccordion>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center gap-3 mb-4">
          <Trophy size={28} className="text-yellow-500" strokeWidth={2} />
          <h2 className="text-2xl font-bold text-gray-900">Ranking Familiar</h2>
        </div>
        {!leaderboardLoaded ? (
          <div className="text-center py-8 bg-white rounded-xl border border-gray-200 text-gray-500">Cargando ranking...</div>
        ) : leaderboard.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
            <p className="text-gray-500">El ranking aparecerá cuando los usuarios configuren su nombre</p>
          </div>
        ) : (
          <Leaderboard rows={leaderboard} meId={profile?.id} />
        )}
      </div>

      {selectedMarket && <TradeModal market={selectedMarket} side={selection.side} onClose={handleClose} />}
    </div>
  )
}
