import { useCallback, useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Lock, TrendingUp } from 'lucide-react'
import { rpc } from '../lib/api'
import { groupMarkets } from '../lib/markets'
import { yesPrice } from '../lib/trading'
import { dateTime, timeShort } from '../lib/format'
import { useGame } from '../context/GameContext'
import { usePolling } from '../hooks/usePolling'
import { useToggleSet } from '../hooks/useToggleSet'
import GroupAccordion from '../components/GroupAccordion'
import PageLoader from '../components/PageLoader'
import TradePanel from '../components/TradePanel'

function MarketRow({ market, selected, onSelect }) {
  const closed = market.closed
  return (
    <button
      onClick={() => onSelect(market.id)}
      className={`w-full text-left bg-white rounded-lg p-3 border-2 transition-all ${
        selected ? 'border-polyblue shadow-md' : 'border-gray-200 hover:border-gray-300'
      } ${closed ? 'opacity-80 hover:opacity-100' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`font-medium text-sm flex-1 ${closed ? 'text-gray-700' : 'text-gray-900'}`}>{market.question}</p>
        <div className="text-right flex-shrink-0">
          {closed ? (
            <>
              <div className={`text-sm font-bold ${market.outcome === 'YES' ? 'text-polygreen' : 'text-polyred'}`}>
                Ganó {market.outcome}
              </div>
              <div className="text-xs text-gray-500">{(yesPrice(market) * 100).toFixed(0)}% final</div>
            </>
          ) : (
            <>
              <div className="text-lg font-bold text-polygreen">{(yesPrice(market) * 100).toFixed(0)}%</div>
              <div className="text-xs text-gray-500">YES</div>
            </>
          )}
        </div>
      </div>
    </button>
  )
}

function MarketList({ title, groups, particular, tone, selectedId, onSelect, open, setOpen }) {
  if (particular.length === 0 && groups.length === 0) return null
  return (
    <div className="mb-6">
      <h3 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wide">{title}</h3>
      <div className="space-y-3">
        {particular.length > 0 && (
          <div className="space-y-2">
            {particular.map((m) => (
              <MarketRow key={m.id} market={m} selected={selectedId === m.id} onSelect={onSelect} />
            ))}
          </div>
        )}
        {groups.map(([topic, list]) => {
          const containsSelected = list.some((m) => m.id === selectedId)
          const isOpen = open[topic] !== undefined ? open[topic] : containsSelected
          return (
            <GroupAccordion
              key={topic}
              topic={topic}
              count={list.length}
              tone={tone}
              open={isOpen}
              hintOpen="Ocultar"
              hintClosed={tone === 'blue' ? 'Toca para ver las opciones' : 'Toca para ver resultados'}
              onToggle={() => setOpen(topic, !isOpen)}
            >
              {list.map((m) => (
                <MarketRow key={m.id} market={m} selected={selectedId === m.id} onSelect={onSelect} />
              ))}
            </GroupAccordion>
          )
        })}
      </div>
    </div>
  )
}

export default function MarketPage() {
  const { activeMarkets, closedMarkets, marketsLoaded } = useGame()
  const [selectedId, setSelectedId] = useState(null)
  const [side, setSide] = useState('YES')
  const [history, setHistory] = useState([])
  const [openActive, , setOpenActive] = useToggleSet()
  const [openClosed, , setOpenClosed] = useToggleSet()

  const selected = useMemo(
    () =>
      activeMarkets.find((m) => m.id === selectedId) ||
      closedMarkets.find((m) => m.id === selectedId) ||
      activeMarkets[0] ||
      closedMarkets[0] ||
      null,
    [activeMarkets, closedMarkets, selectedId]
  )
  const marketId = selected?.id ?? null
  const isClosed = !!selected?.closed

  const fetchHistory = useCallback(async () => {
    if (!marketId) return
    const data = await rpc('get_market_history', { p_market_id: marketId, p_limit: 150 })
    setHistory(data || [])
  }, [marketId])

  useEffect(() => {
    setHistory([])
    fetchHistory().catch(() => {})
  }, [fetchHistory])
  usePolling(fetchHistory, { interval: 20000, enabled: !!marketId && !isClosed })

  const chartData = useMemo(
    () => history.map((h) => ({ at: h.created_at, yes: Number(h.yes_price) * 100, no: Number(h.no_price) * 100 })),
    [history]
  )
  const active = useMemo(() => groupMarkets(activeMarkets), [activeMarkets])
  const closed = useMemo(() => groupMarkets(closedMarkets), [closedMarkets])

  if (!marketsLoaded) return <PageLoader label="Cargando mercados..." />

  if (!selected) {
    return (
      <div className="flex items-center justify-center min-h-screen-safe px-4">
        <div className="text-center">
          <TrendingUp size={64} className="mx-auto text-gray-400 mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No hay mercados disponibles</h3>
          <p className="text-gray-600">Espera a que un administrador cree mercados</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen-safe bg-polygray-bg pb-6">
      <div className="bg-white border-b border-gray-200 p-6">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-lg font-bold text-gray-900 mb-1">{selected.question}</h2>
          {selected.description && <p className="text-sm text-gray-600 mb-3">{selected.description}</p>}
          {isClosed && (
            <div
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg text-sm font-bold mb-3 ${
                selected.outcome === 'YES' ? 'bg-emerald-100 text-polygreen' : 'bg-rose-100 text-polyred'
              }`}
            >
              <Lock size={14} /> MERCADO CERRADO - Ganó {selected.outcome}
            </div>
          )}

          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis
                  dataKey="at"
                  tickFormatter={timeShort}
                  tick={{ fontSize: 12, fill: '#6B7280' }}
                  stroke="#9CA3AF"
                  minTickGap={40}
                />
                <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} stroke="#9CA3AF" domain={[0, 100]} unit="%" width={44} />
                <Tooltip
                  labelFormatter={dateTime}
                  formatter={(v, name) => [`${Number(v).toFixed(1)}%`, name]}
                  contentStyle={{ border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 14 }}
                />
                <Line type="monotone" dataKey="yes" stroke="#009E60" strokeWidth={3} dot={false} name="YES" isAnimationActive={false} />
                <Line type="monotone" dataKey="no" stroke="#E02D3C" strokeWidth={3} dot={false} name="NO" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-60 flex items-center justify-center text-gray-500 bg-gray-50 rounded-lg">
              Aún no hay suficientes datos de precio
            </div>
          )}
        </div>
      </div>

      <div className="bg-white p-4 border-b border-gray-200">
        <div className="max-w-7xl mx-auto">
          <MarketList
            title="Activos"
            tone="blue"
            groups={active.groups}
            particular={active.particular}
            selectedId={selected.id}
            onSelect={setSelectedId}
            open={openActive}
            setOpen={setOpenActive}
          />
          <MarketList
            title="Cerrados"
            tone="gray"
            groups={closed.groups}
            particular={closed.particular}
            selectedId={selected.id}
            onSelect={setSelectedId}
            open={openClosed}
            setOpen={setOpenClosed}
          />
        </div>
      </div>

      {!isClosed ? (
        <div className="bg-white mt-4 mx-4 rounded-xl border border-gray-200 p-6">
          <div className="max-w-xl mx-auto">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Operar</h3>
            <TradePanel market={selected} side={side} onSideChange={setSide} />
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-4 mt-6">
          <div className="bg-gray-50 border-2 border-gray-300 rounded-xl p-6 text-center">
            <Lock size={48} className="mx-auto text-gray-400 mb-3" />
            <h3 className="text-lg font-bold text-gray-700 mb-2">Mercado Cerrado</h3>
            <p className="text-gray-600">Este mercado ya finalizó. Solo puedes ver su historial de precios.</p>
          </div>
        </div>
      )}
    </div>
  )
}
