import { useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { rpc } from '../lib/api'
import { serverNow } from '../lib/clock'
import { fullTime, moneyScale, timeAxis } from '../lib/chartTime'
import { axisMoney, money, percentValue, signedMoney } from '../lib/format'
import { useSeries } from '../hooks/useSeries'
import { AXIS_TICK, ChartBody, ChartBoundary, RangeTabs, emptyFor, sinceFor } from './PriceCharts'

const CASH = '#60A5FA'
const TOTAL = '#009E60'

function PortfolioTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lift px-3 py-2 text-sm">
      <p className="text-xs text-gray-400 mb-1">{fullTime(p.t)}</p>
      <p className="font-extrabold tabular-nums" style={{ color: TOTAL }}>Total {money(p.net)}</p>
      <p className="text-xs font-semibold tabular-nums" style={{ color: CASH }}>Efectivo {money(p.cash)}</p>
      <p className="text-xs font-semibold tabular-nums text-gray-500">En apuestas {money(p.pos)}</p>
    </div>
  )
}

/**
 * Portafolio de un jugador en el tiempo: cuánto tiene en total, y cuánto de eso está en efectivo y cuánto en apuestas abiertas.
 *  · userId: de quién es   · liveNet / liveCash: valores de ahora (para que la línea llegue hasta el presente)
 *  · initial: el dinero con el que se empieza (línea punteada de referencia)
 */
export default function PortfolioChart(props) {
  return (
    <ChartBoundary>
      <PortfolioChartInner {...props} />
    </ChartBoundary>
  )
}

function PortfolioChartInner({ userId, title = 'Mi portafolio', liveNet, liveCash, initial = 1000 }) {
  const [range, setRange] = useState('all')
  const { data, fresh, failed, reload } = useSeries(
    async () => {
      const since = sinceFor(range)
      const rows = (await rpc('get_player_networth', { p_user_id: userId, p_since: since, p_max_points: 80 })) || []
      return { rows, since: since ? Date.parse(since) : null, until: serverNow() }
    },
    `${userId}|${range}`,
    { interval: 45000 }
  )

  const view = useMemo(() => {
    if (!data) return null
    const pts = data.rows.map((r) => {
      const cash = Number(r.cash)
      const net = Number(r.net_worth)
      return { t: Date.parse(r.taken_at), cash, pos: Math.max(Number(r.positions), 0), net }
    })
    const last = pts[pts.length - 1]
    if (last) {
      // La línea llega hasta ahora con los valores en vivo (si se conocen).
      const net = Number.isFinite(liveNet) ? liveNet : last.net
      const cash = Number.isFinite(liveCash) ? Math.min(liveCash, net) : Math.min(last.cash, net)
      pts.push({ t: Math.max(data.until, last.t + 1), cash, pos: Math.max(net - cash, 0), net })
    }
    if (pts.length < 2) return { pts }
    const first = pts[0]
    const end = pts[pts.length - 1]
    let lo = initial
    let hi = initial
    for (const p of pts) {
      lo = Math.min(lo, p.net, p.cash)
      hi = Math.max(hi, p.net, p.cash)
    }
    const pad = Math.max((hi - lo) * 0.12, 8)
    return {
      pts,
      axis: timeAxis(first.t, end.t),
      y: moneyScale(lo - pad, hi + pad),
      change: end.net - first.net,
      changePct: first.net > 0 ? ((end.net - first.net) / first.net) * 100 : 0,
      end,
    }
  }, [data, liveNet, liveCash, initial])

  const up = !view?.axis || view.change >= 0
  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-card p-4" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-gray-900 min-w-0 truncate">{title}</h3>
        <RangeTabs value={range} onChange={setRange} />
      </div>
      <p className={`text-sm font-bold tabular-nums mt-1 mb-2 min-h-[20px] ${up ? 'text-polygreen' : 'text-polyred'}`} data-testid="portfolio-change">
        {view?.axis && (
          <>
            {signedMoney(view.change)} ({percentValue(view.changePct, 1)})
            <span className="text-gray-400 font-medium"> {range === 'all' ? 'desde que empezó' : 'en este rango'}</span>
          </>
        )}
      </p>

      <ChartBody
        height={210}
        data={data}
        fresh={fresh}
        failed={failed}
        reload={reload}
        empty={view && !view.axis ? emptyFor(range, setRange, 'Aquí verás cómo crece tu dinero cuando empiecen las apuestas') : null}
      >
        {view?.axis && (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <ComposedChart data={view.pts} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`pf-total-${userId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TOTAL} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={TOTAL} stopOpacity={0.02} />
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
                domain={view.y.domain}
                ticks={view.y.ticks}
                tickFormatter={axisMoney}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={50}
              />
              <Tooltip content={<PortfolioTooltip />} cursor={{ stroke: '#CBD5E1', strokeDasharray: '3 3' }} />
              <ReferenceLine y={initial} stroke="#9CA3AF" strokeDasharray="4 4" />
              <Area type="monotone" dataKey="net" stroke={TOTAL} strokeWidth={2.6} fill={`url(#pf-total-${userId})`} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="cash" stroke={CASH} strokeWidth={1.8} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </ChartBody>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs font-semibold text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: TOTAL }} /> Total (efectivo + apuestas)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: CASH }} /> Efectivo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-gray-400" /> Inicio ({money(initial, 0)})
        </span>
      </div>
    </section>
  )
}
