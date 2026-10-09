import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Lock, TrendingDown, TrendingUp, XCircle } from 'lucide-react'
import { cents, dateTime, money, percentValue, shares as fmtShares, sideLabel, signedMoney } from '../lib/format'
import AnimatedNumber from './ui/AnimatedNumber'

export function BackButton({ label = 'Atrás' }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800 -ml-1 py-1.5 pr-3"
    >
      <ArrowLeft size={18} /> {label}
    </button>
  )
}

/** Probabilidad grande con el cambio de las últimas 24 h. */
export function ProbabilityHeader({ yes, yes24, label = 'de probabilidad de «Sí»' }) {
  const delta = typeof yes24 === 'number' ? (yes - yes24) * 100 : null
  const show = delta !== null && Math.abs(delta) >= 1
  return (
    <div className="flex items-end gap-3">
      <AnimatedNumber
        value={yes * 100}
        duration={600}
        format={(v) => `${Math.round(v)}%`}
        className="text-[52px] leading-none font-black text-gray-900 tabular-nums"
      />
      <div className="pb-1">
        <p className="text-sm text-gray-500 leading-tight">{label}</p>
        {show && (
          <span
            className={`inline-flex items-center gap-1 text-xs font-bold mt-1 ${delta > 0 ? 'text-polygreen' : 'text-polyred'}`}
          >
            {delta > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {delta > 0 ? '+' : ''}
            {Math.round(delta)} pts en 24 h
          </span>
        )}
      </div>
    </div>
  )
}

export function ResultBlock({ market }) {
  const yes = market.outcome === 'YES'
  const Icon = yes ? CheckCircle2 : XCircle
  return (
    <div
      className={`rounded-3xl p-5 flex items-center gap-4 animate-pop border ${
        yes ? 'bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200' : 'bg-gradient-to-br from-rose-50 to-rose-100 border-rose-200'
      }`}
    >
      <div className={`w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg ${yes ? 'bg-polygreen' : 'bg-polyred'}`}>
        <Icon size={32} strokeWidth={2.5} />
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Resultado final</p>
        <p className={`text-2xl font-extrabold ${yes ? 'text-polygreen' : 'text-polyred'}`}>Ganó «{sideLabel(market.outcome)}»</p>
        {market.resolved_at && <p className="text-xs text-gray-500 mt-0.5">{dateTime(market.resolved_at)}</p>}
      </div>
    </div>
  )
}

export function PendingBlock() {
  return (
    <div className="rounded-3xl p-5 flex items-center gap-4 bg-amber-50 border border-amber-200">
      <div className="w-14 h-14 rounded-full bg-amber-400 text-gray-900 flex items-center justify-center shadow-lg">
        <Lock size={26} className="animate-lock-snap" />
      </div>
      <div>
        <p className="font-extrabold text-amber-900">Apuestas cerradas</p>
        <p className="text-sm text-amber-800 leading-snug">Ya pasó la hora de cierre. En cuanto se confirme el resultado se pagan los premios.</p>
      </div>
    </div>
  )
}

/** Tus acciones en este mercado, con ganancia/pérdida y botón de vender. */
export function PositionStrip({ positions, onSell }) {
  if (!positions.length) return null
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-card divide-y divide-gray-100">
      {positions.map((p) => {
        const positive = p.pnl >= 0
        return (
          <div key={p.key} className="p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-xs font-extrabold px-2 py-0.5 rounded-full ${
                    p.side === 'YES' ? 'bg-emerald-100 text-polygreen' : 'bg-rose-100 text-polyred'
                  }`}
                >
                  {sideLabel(p.side)}
                </span>
                <span className="font-bold text-gray-900 tabular-nums">{fmtShares(p.shares)} acciones</span>
              </div>
              <p className="text-xs text-gray-500">
                Costo prom. {cents(p.avgCost)} · Valor {money(p.currentValue)}
              </p>
              <p className={`text-sm font-bold ${positive ? 'text-polygreen' : 'text-polyred'}`}>
                {signedMoney(p.pnl)} <span className="text-xs font-semibold">({percentValue(p.pnlPercent)})</span>
              </p>
            </div>
            {onSell && !p.closed && (
              <button
                onClick={() => onSell(p.side)}
                className="px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-bold tap-feedback"
              >
                Vender
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Barra fija de abajo con los botones de comprar. */
export function ActionBar({ children }) {
  return (
    <div
      className="fixed inset-x-0 z-30 px-4 pt-3 pb-3 bg-gradient-to-t from-white via-white/95 to-white/0"
      style={{ bottom: 'calc(60px + env(safe-area-inset-bottom))' }}
    >
      <div className="max-w-5xl mx-auto">{children}</div>
    </div>
  )
}
