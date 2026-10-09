import { Briefcase, History, Home, Lightbulb, Trophy, Zap } from 'lucide-react'
import { money } from '../../lib/format'
import { spotPrice } from '../../lib/trading'
import AnimatedNumber from '../ui/AnimatedNumber'
import PriceFlash from '../ui/PriceFlash'
import ChanceRing from '../ChanceRing'

/** Marca el elemento que hay que tocar: anillo amarillo que late y una manito. */
export function Target({ active = true, children, rounded = 'rounded-xl', className = '', hand = true }) {
  return (
    <div className={`relative ${className}`}>
      <div className={`${rounded} ${active ? 'animate-target-pulse' : ''}`}>{children}</div>
      {active && hand && (
        <span className="absolute z-10 text-3xl pointer-events-none animate-hand-tap drop-shadow-md" style={{ right: -2, bottom: -26 }} aria-hidden="true">
          👆
        </span>
      )}
    </div>
  )
}

/** Barra superior de mentira (como la de la app), con el saldo que se mueve. */
export function MiniNav({ sb, moves = 60 }) {
  return (
    <div className="flex items-center justify-between bg-white border border-gray-200 rounded-2xl px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-polyblue rounded-xl flex items-center justify-center text-white font-extrabold text-xs">FM</div>
        <span className="text-xs text-gray-500 font-medium">@tú</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 h-7 px-2.5 rounded-full text-xs font-bold bg-gray-50 border border-gray-200 text-gray-600">
          <Zap size={12} /> <span className="tabular-nums">{moves}</span>
        </span>
        <span className="flex items-center h-7 px-3 rounded-full bg-emerald-50 border border-emerald-200 text-polygreen font-extrabold text-sm tabular-nums" aria-label="Tu saldo de práctica">
          <AnimatedNumber value={sb.balance} flash duration={900} format={(v) => money(v)} />
        </span>
      </div>
    </div>
  )
}

/** Tarjeta de mercado de práctica con los botones Sí / No. */
export function MiniMarketCard({ sb, onYes, onNo, targetYes = false, footer = null, closed = false }) {
  const yes = spotPrice(sb.market, 'YES')
  const y = Math.round(yes * 100)
  const n = 100 - y
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="w-[52px] h-[52px] rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style={{ background: 'linear-gradient(135deg,#93c5fd,#2563eb)' }}>
          ⛅
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[15px] leading-snug text-gray-900">¿Lloverá mañana en Margarita?</h3>
          <div className="mt-1.5 flex items-center gap-2 text-xs font-semibold text-gray-500">
            <span>⛅ Clima</span>
            {footer}
          </div>
        </div>
        <ChanceRing value={yes} />
      </div>
      <div className="mt-3 flex gap-2">
        <Target active={targetYes} className="flex-1">
          <button
            onClick={onYes}
            disabled={closed}
            aria-label={`Comprar Sí a ${y} centavos`}
            className="w-full h-11 rounded-xl font-bold flex items-center justify-center gap-1.5 bg-emerald-50 text-polygreen border border-emerald-200 text-[15px] tap-feedback disabled:opacity-50"
          >
            Sí
            <PriceFlash value={y} className="tabular-nums px-0.5">
              {y}¢
            </PriceFlash>
          </button>
        </Target>
        <button
          onClick={onNo}
          disabled={closed}
          aria-label={`Comprar No a ${n} centavos`}
          className="flex-1 h-11 rounded-xl font-bold flex items-center justify-center gap-1.5 bg-rose-50 text-polyred border border-rose-200 text-[15px] tap-feedback disabled:opacity-50"
        >
          No
          <PriceFlash value={n} className="tabular-nums px-0.5">
            {n}¢
          </PriceFlash>
        </button>
      </div>
    </div>
  )
}

/** Cinta «EN VIVO» de práctica. */
export function MiniTicker({ children }) {
  return (
    <div className="flex items-center gap-3 bg-white rounded-2xl border border-gray-200 shadow-card px-3.5 py-2.5 overflow-hidden">
      <span className="flex items-center gap-1.5 text-[11px] font-extrabold text-red-500 tracking-wide flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-dot-pulse" /> EN VIVO
      </span>
      <p key={String(children)} className="text-sm truncate animate-ticker-in">
        {children}
      </p>
    </div>
  )
}

const TABS = [
  ['home', 'Inicio', Home],
  ['rank', 'Ranking', Trophy],
  ['port', 'Portafolio', Briefcase],
  ['sug', 'Sugerir', Lightbulb],
  ['mem', 'Recuerdos', History],
]

/** Barra inferior de práctica: cada pestaña se puede tocar para ver qué hace. */
export function MiniBottomNav({ active, visited, onTab }) {
  return (
    <div className="flex bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden" role="tablist" aria-label="Pestañas de práctica">
      {TABS.map(([id, label, Icon]) => {
        const seen = visited.has(id)
        const on = active === id
        return (
          <button
            key={id}
            role="tab"
            aria-selected={on}
            aria-label={label}
            onClick={() => onTab(id)}
            className={`relative flex-1 min-w-0 py-2.5 flex flex-col items-center gap-0.5 transition-colors ${on ? 'text-polyblue bg-blue-50/60' : 'text-gray-400'}`}
          >
            <span className={`relative ${seen ? '' : 'animate-target-pulse rounded-full'}`}>
              <Icon size={21} strokeWidth={on ? 2.5 : 2} />
              {seen && (
                <span className="absolute -top-1.5 -right-2 w-4 h-4 rounded-full bg-polygreen text-white text-[9px] font-black flex items-center justify-center animate-pop">✓</span>
              )}
            </span>
            <span className={`text-[10px] ${on ? 'font-bold' : 'font-medium'}`}>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

