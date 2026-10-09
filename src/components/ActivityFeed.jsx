import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, CheckCircle2, ChevronRight, PlusCircle } from 'lucide-react'
import { avatarColor, initials, money, sideLabel } from '../lib/format'
import { timeAgo } from '../lib/time'
import Sheet from './ui/Sheet'

function Avatar({ name, kind }) {
  if (kind === 'MARKET_NEW') {
    return (
      <div className="w-9 h-9 rounded-full bg-blue-50 text-polyblue flex items-center justify-center flex-shrink-0">
        <PlusCircle size={18} />
      </div>
    )
  }
  if (kind === 'MARKET_RESOLVED') {
    return (
      <div className="w-9 h-9 rounded-full bg-emerald-50 text-polygreen flex items-center justify-center flex-shrink-0">
        <CheckCircle2 size={18} />
      </div>
    )
  }
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
      style={{ background: avatarColor(name) }}
    >
      {initials(name)}
    </div>
  )
}

function Sentence({ e }) {
  const who = <b className="text-gray-900">{e.username || 'Alguien'}</b>
  const side = e.side && (
    <b className={e.side === 'YES' ? 'text-polygreen' : 'text-polyred'}>{sideLabel(e.side)}</b>
  )
  if (e.kind === 'BUY')
    return (
      <>
        {who} compró {side} <span className="text-gray-500">· {money(e.amount, 0)}</span>
      </>
    )
  if (e.kind === 'SELL')
    return (
      <>
        {who} vendió {side} <span className="text-gray-500">· {money(e.amount, 0)}</span>
      </>
    )
  if (e.kind === 'MARKET_NEW')
    return (
      <>
        {e.username ? who : <b className="text-gray-900">Nuevo mercado</b>}
        {e.username ? ' creó un mercado' : ''}
      </>
    )
  return (
    <>
      <b className="text-gray-900">Mercado resuelto</b>
      {e.outcome && (
        <>
          : ganó <b className={e.outcome === 'YES' ? 'text-polygreen' : 'text-polyred'}>{sideLabel(e.outcome)}</b>
        </>
      )}
    </>
  )
}

export function EventRow({ event: e, now, showMarket = true }) {
  const navigate = useNavigate()
  const title = e.group_topic ? `${e.group_topic} — ${e.question}` : e.question
  return (
    <button
      onClick={() => e.market_id && navigate(`/m/${e.market_id}`)}
      className="w-full text-left flex items-center gap-3 py-2.5"
    >
      <Avatar name={e.username} kind={e.kind} />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <Sentence e={e} />
        </p>
        {showMarket && <p className="text-xs text-gray-400 truncate">{title}</p>}
      </div>
      <span className="text-[11px] text-gray-400 flex-shrink-0">{timeAgo(e.at, now)}</span>
    </button>
  )
}

/** Lista de movimientos recientes. */
export default function ActivityFeed({ events, showMarket = true, emptyText = 'Todavía no hay movimientos' }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  if (events === null) {
    return (
      <div className="space-y-3 py-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="skeleton w-9 h-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-3.5 w-2/3 rounded" />
              <div className="skeleton h-3 w-1/2 rounded" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (events.length === 0) return <p className="text-center text-sm text-gray-400 py-6">{emptyText}</p>
  return (
    <div className="divide-y divide-gray-100">
      {events.map((e, i) => (
        <EventRow key={`${e.kind}-${e.at}-${e.username}-${e.market_id}-${i}`} event={e} now={now} showMarket={showMarket} />
      ))}
    </div>
  )
}

/**
 * Cinta "En vivo" de la pantalla de inicio: rota los últimos movimientos y,
 * al tocarla, abre la lista completa.
 */
export function ActivityTicker({ events }) {
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState(false)
  const recent = (events || []).slice(0, 6)

  useEffect(() => {
    if (recent.length < 2) return undefined
    const id = setInterval(() => setIndex((i) => (i + 1) % recent.length), 4200)
    return () => clearInterval(id)
  }, [recent.length])

  if (events !== null && events.length === 0) return null
  const e = recent[index % Math.max(recent.length, 1)]

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 bg-white rounded-2xl border border-gray-200 shadow-card px-3.5 py-2.5 text-left tap-feedback"
        aria-label="Ver actividad en vivo"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-extrabold text-red-500 tracking-wide flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-dot-pulse" /> EN VIVO
        </span>
        <div className="min-w-0 flex-1 h-5 overflow-hidden">
          {e ? (
            <p key={`${index}-${e.at}`} className="text-sm leading-5 truncate animate-ticker-in">
              <Sentence e={e} />
              <span className="text-gray-400"> · {e.group_topic || e.question}</span>
            </p>
          ) : (
            <div className="skeleton h-4 w-2/3 rounded mt-0.5" />
          )}
        </div>
        <ChevronRight size={18} className="text-gray-300 flex-shrink-0" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Actividad en vivo" subtitle="Lo que está pasando">
        <ActivityFeed events={events} />
        <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400 mt-4">
          <Activity size={13} /> Se actualiza sola cada pocos segundos
        </p>
      </Sheet>
    </>
  )
}
