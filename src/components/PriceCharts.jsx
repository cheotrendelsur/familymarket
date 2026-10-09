import { useCallback, useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { rpc } from '../lib/api'
import { serverNow } from '../lib/clock'
import { usePolling } from '../hooks/usePolling'

const RANGES = [
  { id: '1h', label: '1H', ms: 3600e3 },
  { id: '6h', label: '6H', ms: 6 * 3600e3 },
  { id: '1d', label: '1D', ms: 24 * 3600e3 },
  { id: 'all', label: 'Todo', ms: null },
]

export const LINE_COLORS = ['#2563EB', '#009E60', '#E02D3C', '#D97706', '#7C3AED', '#0891B2', '#DB2777', '#65A30D']

export function RangeTabs({ value, onChange }) {
  return (
    <div className="inline-flex bg-gray-100 rounded-full p-0.5" role="tablist" aria-label="Rango del gráfico">
      {RANGES.map((r) => (
        <button
          key={r.id}
          role="tab"
          aria-selected={value === r.id}
          onClick={() => onChange(r.id)}
          className={`px-3 py-1 text-xs font-bold rounded-full transition-all ${
            value === r.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

const sinceFor = (range) => {
  const r = RANGES.find((x) => x.id === range)
  return r?.ms ? new Date(serverNow() - r.ms).toISOString() : null
}

// Con menos de ~36 h de datos se muestra la hora; con más, el día.
export const tickFormat = (spanMs) => (t) => {
  const d = new Date(t)
  return spanMs < 36 * 3600e3
    ? d.toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' })
}

const fullTime = (t) =>
  new Date(t).toLocaleString('es-VE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

function useHistory(fetcher, deps, { live }) {
  const [rows, setRows] = useState(null)
  const load = useCallback(async () => {
    setRows(await fetcher())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    setRows(null)
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(load, { interval: 25000, enabled: live })
  useEffect(() => {
    if (!live) load().catch(() => {})
  }, [live, load])
  return rows
}

function EmptyChart({ text }) {
  return (
    <div className="h-[200px] flex items-center justify-center text-sm text-gray-400 bg-gray-50 rounded-2xl">{text}</div>
  )
}

/** Gráfico de la probabilidad de «Sí» de UN mercado. */
export function PriceChart({ marketId, currentYes, live = true }) {
  const [range, setRange] = useState('all')
  const rows = useHistory(
    async () => (await rpc('get_market_history', { p_market_id: marketId, p_limit: 120, p_since: sinceFor(range) })) || [],
    [marketId, range],
    { live }
  )

  const data = useMemo(() => {
    if (!rows) return null
    const pts = rows.map((r) => ({ t: Date.parse(r.created_at), v: Number(r.yes_price) * 100 }))
    if (live && pts.length && Number.isFinite(currentYes)) {
      const last = pts[pts.length - 1]
      const now = serverNow()
      if (now > last.t) pts.push({ t: now, v: currentYes * 100 })
    }
    return pts
  }, [rows, currentYes, live])

  return (
    <div>
      <div className="flex justify-end mb-2">
        <RangeTabs value={range} onChange={setRange} />
      </div>
      {!data ? (
        <div className="skeleton h-[200px] rounded-2xl" />
      ) : data.length < 2 ? (
        <EmptyChart text="Aún no hay suficientes movimientos para dibujar el gráfico" />
      ) : (
        <div className="h-[200px] -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`fill-${marketId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#009E60" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#009E60" stopOpacity={0} />
                </linearGradient>
              </defs>
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
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip
                cursor={{ stroke: '#CBD5E1', strokeDasharray: '3 3' }}
                labelFormatter={fullTime}
                formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Sí']}
                contentStyle={{ border: '1px solid #E5E7EB', borderRadius: 12, fontSize: 13, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}
              />
              <Area type="stepAfter" dataKey="v" stroke="#009E60" strokeWidth={2.5} fill={`url(#fill-${marketId})`} dot={false} isAnimationActive={false} />
              <ReferenceDot x={data[data.length - 1].t} y={data[data.length - 1].v} r={4.5} fill="#009E60" stroke="#fff" strokeWidth={2} ifOverflow="visible" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

/** Gráfico de las opciones de un mercado múltiple (una línea por opción). */
export function GroupChart({ groupId, options, live = true }) {
  const [range, setRange] = useState('all')
  const rows = useHistory(
    async () => (await rpc('get_group_history', { p_group_id: groupId, p_limit: 100, p_since: sinceFor(range) })) || [],
    [groupId, range],
    { live }
  )

  const { data, lines } = useMemo(() => {
    const lines = options.slice(0, 5).map((m, i) => ({ id: m.id, name: m.question, color: LINE_COLORS[i % LINE_COLORS.length], yes: Number(m.yes_pool) }))
    if (!rows || !rows.length) return { data: rows ? [] : null, lines }
    const ids = new Set(lines.map((l) => l.id))
    const times = [...new Set(rows.map((r) => Date.parse(r.created_at)))].sort((a, b) => a - b)
    const byMarket = new Map()
    for (const r of rows) {
      if (!ids.has(r.market_id)) continue
      if (!byMarket.has(r.market_id)) byMarket.set(r.market_id, [])
      byMarket.get(r.market_id).push([Date.parse(r.created_at), Number(r.yes_price) * 100])
    }
    const cursor = new Map(lines.map((l) => [l.id, 0]))
    const held = new Map()
    const data = times.map((t) => {
      const point = { t }
      for (const l of lines) {
        const list = byMarket.get(l.id) || []
        let i = cursor.get(l.id)
        while (i < list.length && list[i][0] <= t) {
          held.set(l.id, list[i][1])
          i += 1
        }
        cursor.set(l.id, i)
        if (held.has(l.id)) point[l.id] = held.get(l.id)
      }
      return point
    })
    return { data, lines }
  }, [rows, options])

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {lines.map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />
              <span className="max-w-[96px] truncate">{l.name}</span>
            </span>
          ))}
        </div>
        <RangeTabs value={range} onChange={setRange} />
      </div>
      {!data ? (
        <div className="skeleton h-[220px] rounded-2xl" />
      ) : data.length < 2 ? (
        <EmptyChart text="Aún no hay suficientes movimientos para dibujar el gráfico" />
      ) : (
        <div className="h-[220px] -mx-1">
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
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip
                labelFormatter={fullTime}
                formatter={(v, key) => [`${Number(v).toFixed(1)}%`, lines.find((l) => l.id === key)?.name || key]}
                contentStyle={{ border: '1px solid #E5E7EB', borderRadius: 12, fontSize: 13, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}
              />
              {lines.map((l) => (
                <Line key={l.id} type="stepAfter" dataKey={l.id} stroke={l.color} strokeWidth={2.4} dot={false} isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
