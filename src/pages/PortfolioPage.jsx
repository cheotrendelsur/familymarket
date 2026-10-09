import { useCallback, useMemo, useState } from 'react'
import { Briefcase, CheckCircle, DollarSign, History, TrendingUp, Zap } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { rpc } from '../lib/api'
import { buildPosition, groupPositions } from '../lib/portfolio'
import { money } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { usePolling } from '../hooks/usePolling'
import { useToggleSet } from '../hooks/useToggleSet'
import GroupAccordion from '../components/GroupAccordion'
import OperationsList from '../components/OperationsList'
import PageLoader from '../components/PageLoader'
import PositionCard from '../components/PositionCard'

function PositionSections({ positions, tone, open, toggle }) {
  const { particular, groups } = useMemo(() => groupPositions(positions), [positions])
  return (
    <div className="space-y-5">
      {particular.length > 0 && (
        <div className="space-y-3">
          {particular.map((p) => (
            <PositionCard key={p.key} position={p} />
          ))}
        </div>
      )}
      {groups.map(([topic, list]) => (
        <GroupAccordion
          key={topic}
          topic={`🎯 ${topic}`}
          count={list.length}
          tone={tone}
          hintOpen="Ocultar"
          hintClosed="Toca para ver tus posiciones"
          open={!!open[topic]}
          onToggle={() => toggle(topic)}
        >
          {list.map((p) => (
            <PositionCard key={p.key} position={p} />
          ))}
        </GroupAccordion>
      ))}
    </div>
  )
}

export default function PortfolioPage() {
  const { profile } = useAuth()
  const { markets, config, daily } = useGame()
  const [raw, setRaw] = useState(null)
  const [operations, setOperations] = useState([])
  const [showOps, setShowOps] = useState(false)
  const [openActive, toggleActive] = useToggleSet()
  const [openClosed, toggleClosed] = useToggleSet()

  const fetchPortfolio = useCallback(async () => {
    const data = await rpc('get_my_portfolio')
    setRaw(data?.positions || [])
  }, [])
  const { refresh: refreshPortfolio } = usePolling(fetchPortfolio, { interval: 45000, enabled: !!profile })

  const fetchOperations = useCallback(async () => {
    const { data } = await supabase
      .from('transactions')
      .select('id, market_id, type, side, shares_amount, price_per_share, total_cost, created_at, markets(question)')
      .order('created_at', { ascending: false })
      .limit(100)
    setOperations(
      (data || []).map((t) => ({
        id: t.id,
        at: t.created_at,
        question: t.markets?.question || 'Mercado',
        type: t.type,
        side: t.side,
        shares: t.shares_amount,
        price: t.price_per_share,
        total: t.total_cost,
      }))
    )
  }, [])

  const toggleOps = async () => {
    const next = !showOps
    setShowOps(next)
    if (next) await fetchOperations()
  }

  // Los precios vienen EN VIVO del contexto (se actualiza solo); aquí solo hay acciones y costo.
  const positions = useMemo(() => {
    if (!raw) return null
    const byId = new Map(markets.map((m) => [m.id, m]))
    return raw.map((p) => buildPosition(p, byId.get(p.market_id)))
  }, [raw, markets])

  if (!positions) return <PageLoader label="Cargando portafolio..." />

  const active = positions.filter((p) => !p.closed)
  const closed = positions.filter((p) => p.closed)
  const cash = profile?.balance ?? 0
  const inShares = active.reduce((sum, p) => sum + p.currentValue, 0)
  const remaining = daily?.remaining
  const limit = daily?.limit ?? config.daily_limit

  return (
    <div className="min-h-screen-safe bg-polygray-bg px-4 py-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-gradient-to-br from-polyblue to-blue-600 rounded-2xl p-6 text-white shadow-xl">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              <DollarSign size={20} strokeWidth={2.5} />
              <span className="text-sm font-semibold opacity-90">Valor total de la cuenta</span>
            </div>
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-bold text-sm border-2 ${
                remaining !== undefined && remaining <= 5
                  ? 'bg-red-500 bg-opacity-20 border-red-300'
                  : 'bg-white bg-opacity-20 border-white border-opacity-30'
              }`}
            >
              <Zap size={16} strokeWidth={2.5} />
              <span>
                {remaining ?? '...'}/{limit}
              </span>
            </div>
          </div>
          <div className="text-5xl font-bold mb-4">{money(cash + inShares)}</div>
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white border-opacity-20">
            <div>
              <div className="text-xs opacity-75 mb-1">Efectivo disponible</div>
              <div className="text-xl font-bold">{money(cash)}</div>
            </div>
            <div>
              <div className="text-xs opacity-75 mb-1">En acciones activas</div>
              <div className="text-xl font-bold">{money(inShares)}</div>
            </div>
          </div>
        </div>

        <section>
          <div className="flex items-center gap-3 mb-4">
            <Briefcase size={24} className="text-gray-700" strokeWidth={2} />
            <h2 className="text-2xl font-bold text-gray-900">Posiciones Activas</h2>
          </div>
          {active.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
              <TrendingUp size={64} className="mx-auto text-gray-400 mb-4" strokeWidth={1.5} />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No tienes posiciones activas</h3>
              <p className="text-gray-600">Compra acciones en la pestaña Home para empezar a operar</p>
            </div>
          ) : (
            <PositionSections positions={active} tone="blue" open={openActive} toggle={toggleActive} />
          )}
        </section>

        <section>
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle size={24} className="text-gray-700" strokeWidth={2} />
            <h2 className="text-2xl font-bold text-gray-900">Historial de Resultados</h2>
          </div>
          {closed.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-600">Aún no tienes resultados de mercados finalizados</p>
            </div>
          ) : (
            <PositionSections positions={closed} tone="gray" open={openClosed} toggle={toggleClosed} />
          )}
        </section>

        <section>
          <button
            onClick={toggleOps}
            className="w-full flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm"
          >
            <span className="flex items-center gap-3 font-bold text-gray-900 text-lg">
              <History size={22} className="text-gray-700" /> Historial de operaciones
            </span>
            <span className="text-sm font-semibold text-polyblue">{showOps ? 'Ocultar' : 'Ver'}</span>
          </button>
          {showOps && (
            <div className="mt-3">
              <OperationsList ops={operations} emptyText="Aún no has hecho operaciones" />
            </div>
          )}
        </section>

        <button onClick={refreshPortfolio} className="w-full text-center text-sm text-gray-400 py-2">
          Actualizar portafolio
        </button>
      </div>
    </div>
  )
}
