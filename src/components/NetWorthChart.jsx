import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { rpc } from '../lib/api'
import { serverNow } from '../lib/clock'
import { fullTime, moneyScale, timeAxis } from '../lib/chartTime'
import { axisMoney, money } from '../lib/format'
import { useSeries } from '../hooks/useSeries'
import { AXIS_TICK, ChartBody, ChartBoundary, LINE_COLORS, RangeTabs, TOOLTIP_STYLE, sinceFor } from './PriceCharts'

/** "Carrera de patrimonio": cómo se mueve la fortuna de cada jugador en el tiempo. */
export default function NetWorthChart(props) {
  return (
    <ChartBoundary>
      <NetWorthChartInner {...props} />
    </ChartBoundary>
  )
}

function NetWorthChartInner({ leaderboard, meId }) {
  const [range, setRange] = useState('all')
  const [showAll, setShowAll] = useState(false)
  const [hidden, setHidden] = useState({})

  const { data, fresh, failed, reload } = useSeries(
    async () => {
      const since = sinceFor(range)
      const rows = (await rpc('get_networth_race', { p_since: since, p_max_points: 80 })) || []
      return { rows, since: since ? Date.parse(since) : null, until: serverNow() }
    },
    range,
    { interval: 45000 }
  )

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

  const view = useMemo(() => {
    if (!data) return null
    const byTime = new Map()
    for (const r of data.rows) {
      const t = Date.parse(r.taken_at)
      if (!byTime.has(t)) byTime.set(t, { t })
      byTime.get(t)[r.user_id] = Number(r.net_worth)
    }
    const pts = [...byTime.values()].sort((a, b) => a.t - b.t)
    // Punto "ahora" con los valores en vivo del ranking.
    if (pts.length && players.length) {
      const live = { t: Math.max(data.until, pts[pts.length - 1].t + 1) }
      for (const p of players) live[p.id] = p.net
      pts.push(live)
    }
    if (pts.length < 2) return { pts }
    return { pts, axis: timeAxis(pts[0].t, pts[pts.length - 1].t) }
  }, [data, players])

  const yScale = useMemo(() => {
    if (!view?.pts.length) return moneyScale(0, 1)
    let lo = Infinity
    let hi = -Infinity
    for (const pt of view.pts)
      for (const p of shown) {
        const v = pt[p.id]
        if (typeof v === 'number') {
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        }
      }
    if (!Number.isFinite(lo)) return moneyScale(0, 1)
    const pad = Math.max((hi - lo) * 0.1, 10)
    return moneyScale(lo - pad, hi + pad)
  }, [view, shown])

  const empty = view && !view.axis
    ? range === 'all'
      ? { text: 'La carrera empieza con las primeras operaciones. Aquí verás quién va subiendo y quién cayendo.' }
      : { text: 'Nadie se movió en este rango', actionLabel: 'Ver todo el historial', onAction: () => setRange('all') }
    : null

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-card p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-bold text-gray-900">Carrera de patrimonio</h3>
        <RangeTabs value={range} onChange={setRange} />
      </div>

      <ChartBody height={240} data={data} fresh={fresh} failed={failed} reload={reload} empty={empty}>
        {view?.axis && (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={view.pts} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#EEF0F3" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={view.axis.domain}
                ticks={view.axis.ticks}
                tickFormatter={view.axis.format}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                minTickGap={36}
              />
              <YAxis
                domain={yScale.domain}
                ticks={yScale.ticks}
                tickFormatter={axisMoney}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={50}
              />
              <Tooltip
                labelFormatter={fullTime}
                formatter={(v, key) => [money(v), players.find((p) => p.id === key)?.name || key]}
                itemSorter={(item) => -item.value}
                contentStyle={TOOLTIP_STYLE}
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
        )}
      </ChartBody>

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
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold border transition-opacity ${
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
