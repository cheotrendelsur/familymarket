import { Component, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { rpc } from '../lib/api'
import { serverNow } from '../lib/clock'
import { fullTime, timeAxis } from '../lib/chartTime'
import { useSeries } from '../hooks/useSeries'

export const RANGES = [
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
          className={`px-3.5 py-2 text-xs font-bold rounded-full transition-all ${
            value === r.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

/** Desde cuándo pedir los datos para un rango (ISO) o null = todo el historial. */
export const sinceFor = (range) => {
  const r = RANGES.find((x) => x.id === range)
  return r?.ms ? new Date(serverNow() - r.ms).toISOString() : null
}

/** Marco fijo de la gráfica: misma altura siempre (sin saltos) y atenuado mientras llega el rango nuevo. */
export function ChartFrame({ height, busy = false, children }) {
  return (
    <div className={`relative -mx-1 transition-opacity duration-200 ${busy ? 'opacity-50' : ''}`} style={{ height }} aria-busy={busy}>
      {children}
      {busy && (
        <span className="absolute top-1 right-3 text-[11px] font-semibold text-gray-500 bg-white/90 rounded-full px-2 py-0.5">Cargando…</span>
      )}
    </div>
  )
}

export function EmptyChart({ text, actionLabel, onAction }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-center text-sm text-gray-400 bg-gray-50 rounded-2xl px-6">
      <p>{text}</p>
      {actionLabel && (
        <button onClick={onAction} className="text-xs font-bold text-polyblue px-3 py-1.5 rounded-full bg-white border border-gray-200">
          {actionLabel}
        </button>
      )}
    </div>
  )
}

/**
 * Si una gráfica fallara por un dato inesperado, que no se caiga toda la pantalla: solo esa gráfica
 * muestra «No se pudo mostrar» con un botón para reintentar.
 */
export class ChartBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="h-[200px]">
        <EmptyChart text="No se pudo mostrar el gráfico" actionLabel="Reintentar" onAction={() => this.setState({ failed: false })} />
      </div>
    )
  }
}

/** Cuerpo común de las gráficas: esqueleto al cargar, error con reintento, o el gráfico. */
export function ChartBody({ height, data, fresh, failed, reload, empty, children }) {
  return (
    <ChartFrame height={height} busy={!!data && !fresh}>
      {!data ? (
        failed ? (
          <EmptyChart text="No se pudo cargar el gráfico" actionLabel="Reintentar" onAction={reload} />
        ) : (
          <div className="skeleton h-full rounded-2xl" />
        )
      ) : empty ? (
        <EmptyChart {...empty} />
      ) : (
        children
      )}
    </ChartFrame>
  )
}

export const AXIS_TICK = { fontSize: 11, fill: '#9CA3AF' }
export const TOOLTIP_STYLE = { border: '1px solid #E5E7EB', borderRadius: 12, fontSize: 13, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }

export const emptyFor = (range, setRange, allText = 'Aún no hay suficientes movimientos para dibujar el gráfico') =>
  range === 'all'
    ? { text: allText }
    : { text: 'No hubo movimientos en este rango', actionLabel: 'Ver todo el historial', onAction: () => setRange('all') }

/** Gráfico de la probabilidad de «Sí» de UN mercado. */
export function PriceChart(props) {
  return (
    <ChartBoundary>
      <PriceChartInner {...props} />
    </ChartBoundary>
  )
}

function PriceChartInner({ marketId, currentYes, live = true }) {
  const [range, setRange] = useState('all')
  const { data, fresh, failed, reload } = useSeries(
    async () => {
      const since = sinceFor(range)
      const rows = (await rpc('get_market_history', { p_market_id: marketId, p_limit: 120, p_since: since })) || []
      return { rows, since: since ? Date.parse(since) : null, until: serverNow() }
    },
    `${marketId}|${range}`,
    { live }
  )

  const view = useMemo(() => {
    if (!data) return null
    const pts = data.rows.map((r) => ({ t: Date.parse(r.created_at), v: Number(r.yes_price) * 100 }))
    const last = pts[pts.length - 1]
    // La línea llega hasta «ahora» (mercado abierto) o hasta el final de la ventana elegida.
    if (last && data.until > last.t && (live || data.since != null)) {
      pts.push({ t: data.until, v: live && Number.isFinite(currentYes) ? currentYes * 100 : last.v })
    }
    if (pts.length < 2) return { pts }
    return { pts, axis: timeAxis(pts[0].t, pts[pts.length - 1].t) }
  }, [data, currentYes, live])

  const end = view?.pts[view.pts.length - 1]
  return (
    <div>
      <div className="flex justify-end mb-2">
        <RangeTabs value={range} onChange={setRange} />
      </div>
      <ChartBody height={200} data={data} fresh={fresh} failed={failed} reload={reload} empty={view && !view.axis ? emptyFor(range, setRange) : null}>
        {view?.axis && (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart data={view.pts} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
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
                domain={view.axis.domain}
                ticks={view.axis.ticks}
                tickFormatter={view.axis.format}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                minTickGap={36}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip
                cursor={{ stroke: '#CBD5E1', strokeDasharray: '3 3' }}
                labelFormatter={fullTime}
                formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Sí']}
                contentStyle={TOOLTIP_STYLE}
              />
              <Area type="stepAfter" dataKey="v" stroke="#009E60" strokeWidth={2.5} fill={`url(#fill-${marketId})`} dot={false} isAnimationActive={false} />
              <ReferenceDot x={end.t} y={end.v} r={4.5} fill="#009E60" stroke="#fff" strokeWidth={2} ifOverflow="visible" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartBody>
    </div>
  )
}

/** Gráfico de las opciones de un mercado múltiple (una línea por opción). */
export function GroupChart(props) {
  return (
    <ChartBoundary>
      <GroupChartInner {...props} />
    </ChartBoundary>
  )
}

function GroupChartInner({ groupId, options, live = true }) {
  const [range, setRange] = useState('all')
  const { data, fresh, failed, reload } = useSeries(
    async () => {
      const since = sinceFor(range)
      const rows = (await rpc('get_group_history', { p_group_id: groupId, p_limit: 100, p_since: since })) || []
      return { rows, since: since ? Date.parse(since) : null, until: serverNow() }
    },
    `${groupId}|${range}`,
    { live }
  )

  const lines = useMemo(
    () => options.slice(0, 5).map((m, i) => ({ id: m.id, name: m.question, color: LINE_COLORS[i % LINE_COLORS.length] })),
    [options]
  )

  const view = useMemo(() => {
    if (!data) return null
    const rows = data.rows
    if (!rows.length) return { pts: [] }
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
    const pts = times.map((t) => {
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
    // Cada precio se mantiene hasta «ahora» (mercado abierto) o hasta el final de la ventana elegida.
    const last = pts[pts.length - 1]
    if (last && data.until > last.t && (live || data.since != null)) pts.push({ ...last, t: data.until })
    if (pts.length < 2) return { pts }
    return { pts, axis: timeAxis(pts[0].t, pts[pts.length - 1].t) }
  }, [data, lines, live])

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
      <ChartBody height={220} data={data} fresh={fresh} failed={failed} reload={reload} empty={view && !view.axis ? emptyFor(range, setRange) : null}>
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
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip
                labelFormatter={fullTime}
                formatter={(v, key) => [`${Number(v).toFixed(1)}%`, lines.find((l) => l.id === key)?.name || key]}
                contentStyle={TOOLTIP_STYLE}
              />
              {lines.map((l) => (
                <Line key={l.id} type="stepAfter" dataKey={l.id} stroke={l.color} strokeWidth={2.4} dot={false} isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartBody>
    </div>
  )
}
