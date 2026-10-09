import { useCallback, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { rpc } from '../lib/api'
import { serverNow } from '../lib/clock'
import { compactMoney, money } from '../lib/format'
import { usePolling } from '../hooks/usePolling'
import { LINE_COLORS, RangeTabs, tickFormat } from './PriceCharts'

const RANGE_MS = { '1h': 3600e3, '6h': 6 * 3600e3, '1d': 24 * 3600e3, all: null }

const full = (t) => new Date(t).toLocaleString('es-VE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** "Carrera de patrimonio": cómo se mueve la fortuna de cada jugador en el tiempo. */
export default function NetWorthChart({ leaderboard, meId }) {
  const [range, setRange] = useState('all')
  const [rows, setRows] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [hidden, setHidden] = useState({})

  const load = useCallback(async () => {
    const since = RANGE_MS[range] ? new Date(serverNow() - RANGE_MS[range]).toISOString() : null
    setRows((await rpc('get_networth_race', { p_since: since, p_max_points: 80 })) || [])
  }, [range])
  usePolling(load, { interval: 45000 })

  const players = useMemo(
    () =>
      leaderboard.map((p, i) => ({
        id: p.user_id,
        name: p.username,
        color: LINE_COLORS[i % LINE_COLORS.length],
        net: Number(p.net_worth),
        rank: p.rank,
        me: p.user_id === meId,
      })),
    [leaderboard, meId]
  )

  const shown = useMemo(
    () => players.filter((p) => !hidden[p.id] && (showAll || p.rank <= 5 || p.me)),
    [players, hidden, showAll]
  )

  const data = useMemo(() => {
    if (!rows) return null
    const byTime = new Map()
    for (const r of rows) {
      const t = Date.parse(r.taken_at)
      if (!byTime.has(t)) byTime.set(t, { t })
      byTime.get(t)[r.user_id] = Number(r.net_worth)
    }
    const points = [...byTime.values()].sort((a, b) => a.t - b.t)
    // Punto "ahora" con los valores en vivo del ranking.
    if (points.length && players.length) {
      const live = { t: serverNow() }
      for (const p of players) live[p.id] = p.net
      if (live.t > points[points.length - 1].t) points.push(live)
    }
    return points
  }, [rows, players])

  const domain = useMemo(() => {
    if (!data?.length) return [0, 1]
    let lo = Infinity
    let hi = -Infinity
    for (const pt of data)
      for (const p of shown) {
        const v = pt[p.id]
        if (typeof v === 'number') {
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        }
      }
    if (!Number.isFinite(lo)) return [0, 1]
    const pad = Math.max((hi - lo) * 0.12, 15)
    return [Math.floor(lo - pad), Math.ceil(hi + pad)]
  }, [data, shown])

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-card p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-bold text-gray-900">Carrera de patrimonio</h3>
        <RangeTabs value={range} onChange={setRange} />
      </div>

      {!data ? (
        <div className="skeleton h-[240px] rounded-2xl" />
      ) : data.length < 2 ? (
        <div className="h-[240px] flex items-center justify-center text-center text-sm text-gray-400 bg-gray-50 rounded-2xl px-6">
          La carrera empieza con las primeras operaciones. Aquí verás quién va subiendo y quién cayendo.
        </div>
      ) : (
        <div className="h-[240px] -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#EEF0F3" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={tickFormat(data[data.length - 1].t - data[0].t)}
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                axisLine={false}
                tickLine={false}
                minTickGap={50}
                tickCount={4}
              />
              <YAxis
                domain={domain}
                tickFormatter={(v) => compactMoney(v)}
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                axisLine={false}
                tickLine={false}
                width={46}
                tickCount={5}
              />
              <Tooltip
                labelFormatter={full}
                formatter={(v, key) => [money(v), players.find((p) => p.id === key)?.name || key]}
                itemSorter={(item) => -item.value}
                contentStyle={{ border: '1px solid #E5E7EB', borderRadius: 12, fontSize: 13, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}
              />
              {shown.map((p) => (
                <Line
                  key={p.id}
                  type="monotone"
                  dataKey={p.id}
                  stroke={p.color}
                  strokeWidth={p.me ? 3.4 : 2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mt-3">
        {players
          .filter((p) => showAll || p.rank <= 5 || p.me)
          .map((p) => {
            const off = hidden[p.id]
            return (
              <button
                key={p.id}
                onClick={() => setHidden((h) => ({ ...h, [p.id]: !h[p.id] }))}
                aria-pressed={!off}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-opacity ${
                  off ? 'opacity-40 border-gray-200 text-gray-500' : 'border-gray-200 text-gray-700 bg-white'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                {p.name}
                {p.me && <span className="text-polyblue">(tú)</span>}
              </button>
            )
          })}
        {players.length > 6 && (
          <button onClick={() => setShowAll(!showAll)} className="px-2.5 py-1 rounded-full text-xs font-bold text-polyblue">
            {showAll ? 'Solo los 5 primeros' : `Ver los ${players.length}`}
          </button>
        )}
      </div>
    </div>
  )
}
