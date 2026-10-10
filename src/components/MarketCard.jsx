import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, CheckCircle2, ChevronRight, Flame, Lock, Sparkles, XCircle } from 'lucide-react'
import { categoryOf } from '../lib/categories'
import { yesPrice } from '../lib/trading'
import { sideLabel } from '../lib/format'
import { closesLabel } from '../lib/time'
import ChanceRing from './ChanceRing'
import MarketImage from './MarketImage'
import PriceFlash from './ui/PriceFlash'
import YesNoButtons from './YesNoButtons'
import { StateBadge } from './Countdown'

export function CategoryTag({ category, className = '' }) {
  const cat = categoryOf(category)
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold text-gray-500 ${className}`}>
      <span aria-hidden="true">{cat.emoji}</span>
      {cat.label}
    </span>
  )
}

export function Badges({ item, hot }) {
  return (
    <>
      {hot && (
        <span className="inline-flex items-center gap-0.5 text-xs font-bold text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5">
          <Flame size={12} /> Tendencia
        </span>
      )}
      {!hot && item.isNew && item.state === 'open' && (
        <span className="inline-flex items-center gap-0.5 text-xs font-bold text-polyblue bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
          <Sparkles size={12} /> Nuevo
        </span>
      )}
    </>
  )
}

/** Resultado de un mercado ya resuelto, dentro de la tarjeta. */
export function ResultBanner({ market }) {
  const yes = market.outcome === 'YES'
  const Icon = yes ? CheckCircle2 : XCircle
  return (
    <div
      className={`rounded-xl px-3 py-2.5 flex items-center justify-center gap-2 font-bold border ${
        yes ? 'bg-emerald-50 border-emerald-200 text-polygreen' : 'bg-rose-50 border-rose-200 text-polyred'
      }`}
    >
      <Icon size={20} strokeWidth={2.5} /> Ganó «{sideLabel(market.outcome)}»
    </div>
  )
}

export function UpcomingBanner({ opensAt }) {
  return (
    <div className="rounded-xl px-3 py-2.5 flex items-center justify-center gap-2 font-semibold bg-violet-50 border border-violet-200 text-violet-800 text-sm">
      <CalendarClock size={16} /> Abre el {closesLabel(opensAt)}
    </div>
  )
}

export function PendingBanner() {
  return (
    <div className="rounded-xl px-3 py-2.5 flex items-center justify-center gap-2 font-semibold bg-amber-50 border border-amber-200 text-amber-800 text-sm">
      <Lock size={16} /> Apuestas cerradas · falta el resultado
    </div>
  )
}

/** Tarjeta de un mercado suelto (estilo Polymarket). */
function MarketCard({ item, hot = false, onTrade }) {
  const navigate = useNavigate()
  const m = item.market
  const yes = yesPrice(m)
  const go = () => navigate(`/m/${m.id}`)

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => e.key === 'Enter' && go()}
      className="bg-white rounded-2xl border border-gray-200 shadow-card p-3.5 cursor-pointer tap-feedback hover:shadow-lift hover:border-gray-300 transition-shadow animate-slide-up"
    >
      <div className="flex items-start gap-3">
        <MarketImage item={item} size={52} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[15px] leading-snug text-gray-900 line-clamp-2">{m.question}</h3>
          <div className="mt-1.5 flex items-center gap-x-2 gap-y-1 flex-wrap">
            <CategoryTag category={item.category} />
            {(item.state === 'open' || item.state === 'upcoming') && <StateBadge item={item} />}
            <Badges item={item} hot={hot} />
          </div>
        </div>
        {item.state !== 'resolved' && <ChanceRing value={yes} />}
      </div>

      <div className="mt-3">
        {item.state === 'open' && <YesNoButtons market={m} onPick={onTrade} />}
        {item.state === 'upcoming' && <UpcomingBanner opensAt={m.opens_at} />}
        {item.state === 'pending' && <PendingBanner />}
        {item.state === 'resolved' && <ResultBanner market={m} />}
      </div>
    </article>
  )
}

export default memo(MarketCard)

/** Fila de una opción dentro de un mercado múltiple (nombre, %, botones Sí/No). */
export const OptionRow = memo(function OptionRow({ market, onTrade, onOpen, rank }) {
  const yes = yesPrice(market)
  const resolved = market.state === 'resolved'
  const pending = market.state === 'pending'
  const upcoming = market.state === 'upcoming'
  return (
    <div className="flex items-center gap-2 py-2">
      <button onClick={onOpen} className="flex items-center gap-2 min-w-0 flex-1 text-left">
        {rank !== undefined && <span className="text-xs font-bold text-gray-300 w-3 flex-shrink-0">{rank}</span>}
        <span className="font-medium text-[14px] text-gray-800 truncate">{market.question}</span>
      </button>
      {resolved ? (
        <span
          className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${
            market.outcome === 'YES' ? 'bg-emerald-50 text-polygreen' : 'bg-rose-50 text-polyred'
          }`}
        >
          {market.outcome === 'YES' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
          {sideLabel(market.outcome)}
        </span>
      ) : (
        <>
          <PriceFlash value={Math.round(yes * 100)} className="font-extrabold text-[15px] tabular-nums w-10 text-right">
            {Math.round(yes * 100)}%
          </PriceFlash>
          {pending ? (
            <span className="text-[11px] font-bold text-amber-700 bg-amber-50 rounded-full px-2 py-1 flex items-center gap-1">
              <Lock size={11} /> Cerrado
            </span>
          ) : upcoming ? (
            <span className="text-[11px] font-bold text-violet-700 bg-violet-50 rounded-full px-2 py-1">Próximamente</span>
          ) : (
            <YesNoButtons market={market} onPick={onTrade} compact />
          )}
        </>
      )}
    </div>
  )
})

/** Tarjeta de un mercado múltiple: título + las opciones más probables. */
export const GroupCard = memo(function GroupCard({ item, hot = false, onTrade, maxOptions = 3 }) {
  const navigate = useNavigate()
  const go = () => navigate(`/g/${item.id}`)
  const shown = item.markets.slice(0, maxOptions)
  const extra = item.markets.length - shown.length
  const leader = item.markets[0]

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => e.key === 'Enter' && go()}
      className="bg-white rounded-2xl border border-gray-200 shadow-card p-3.5 cursor-pointer hover:shadow-lift hover:border-gray-300 transition-shadow animate-slide-up"
    >
      <div className="flex items-start gap-3">
        <MarketImage item={item} size={52} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[15px] leading-snug text-gray-900 line-clamp-2">{item.title}</h3>
          <div className="mt-1.5 flex items-center gap-x-2 gap-y-1 flex-wrap">
            <CategoryTag category={item.category} />
            <StateBadge item={item} />
            <Badges item={item} hot={hot} />
          </div>
        </div>
      </div>

      <div className="mt-2 divide-y divide-gray-100" onClick={(e) => e.stopPropagation()}>
        {shown.map((m, i) => (
          <OptionRow key={m.id} market={m} rank={i + 1} onTrade={onTrade} onOpen={go} />
        ))}
      </div>

      <button
        onClick={go}
        className="mt-1.5 w-full flex items-center justify-center gap-1 text-sm font-semibold text-polyblue py-1.5"
      >
        {extra > 0 ? `Ver ${extra} opción${extra === 1 ? '' : 'es'} más` : leader?.state === 'resolved' ? 'Ver resultados' : 'Ver todo'}
        <ChevronRight size={16} />
      </button>
    </article>
  )
})
