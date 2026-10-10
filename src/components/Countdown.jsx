import { useEffect, useState } from 'react'
import { CalendarClock, CheckCircle2, Clock, Lock, XCircle } from 'lucide-react'
import { serverNow } from '../lib/clock'
import { countdown } from '../lib/time'
import { sideLabel } from '../lib/format'

/** Cuenta regresiva hasta `closesAt` (hora del servidor). Late más rápido cuanto menos queda. */
export function useCountdown(closesAt) {
  const target = closesAt ? Date.parse(closesAt) : null
  const [now, setNow] = useState(serverNow)

  useEffect(() => {
    if (!target) return undefined
    let timer
    const loop = () => {
      const n = serverNow()
      setNow(n)
      const left = target - n
      if (left <= 0) return
      const step = left < 3_600_000 ? 1000 : left < 86_400_000 ? 15_000 : 60_000
      timer = setTimeout(loop, Math.min(step, left + 50))
    }
    loop()
    return () => clearTimeout(timer)
  }, [target])

  if (!target) return null
  return { ...countdown(target - now), over: target - now <= 0 }
}

/** Pastilla "Cierra en 2h 15m". Ámbar bajo 1 h, roja y latiendo bajo 5 min. */
export function Countdown({ closesAt, className = '', full = false }) {
  const c = useCountdown(closesAt)
  if (!c) return null
  if (c.over) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-bold text-amber-700 ${className}`}>
        <Lock size={12} className="animate-lock-snap" /> Apuestas cerradas
      </span>
    )
  }
  const critical = c.total < 300
  const tone = critical
    ? 'bg-red-50 text-red-600 border-red-200'
    : c.urgent
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-gray-50 text-gray-600 border-gray-200'
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-bold border rounded-full px-2 py-0.5 tabular-nums ${tone} ${className}`}
    >
      <Clock size={12} className={critical ? 'animate-dot-pulse' : ''} />
      {full ? `Cierra en ${c.text}` : c.text}
    </span>
  )
}

/** Pastilla "Abre en 2h 15m" para mercados con apertura programada. */
export function OpensIn({ opensAt, className = '' }) {
  const c = useCountdown(opensAt)
  if (!c) return null
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold border rounded-full px-2 py-0.5 tabular-nums bg-violet-50 text-violet-700 border-violet-200 ${className}`}>
      <CalendarClock size={12} /> {c.over ? 'Abriendo…' : `Abre en ${c.text}`}
    </span>
  )
}

/** Estado visible de una tarjeta: cuenta regresiva, "esperando resultado" o resultado. */
export function StateBadge({ item, className = '' }) {
  if (item.state === 'upcoming') return <OpensIn opensAt={item.opens_at} className={className} />
  if (item.state === 'pending') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-dot-pulse" />
        Esperando resultado
      </span>
    )
  }
  if (item.state === 'resolved') {
    if (item.kind === 'single') {
      const yes = item.market.outcome === 'YES'
      const Icon = yes ? CheckCircle2 : XCircle
      return (
        <span
          className={`inline-flex items-center gap-1 text-xs font-bold rounded-full px-2 py-0.5 border ${
            yes ? 'text-polygreen bg-emerald-50 border-emerald-200' : 'text-polyred bg-rose-50 border-rose-200'
          } ${className}`}
        >
          <Icon size={12} /> Resultado: {sideLabel(item.market.outcome)}
        </span>
      )
    }
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs font-bold text-gray-600 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5 ${className}`}
      >
        <CheckCircle2 size={12} /> Resuelto
      </span>
    )
  }
  if (item.closes_at) return <Countdown closesAt={item.closes_at} className={className} />
  return null
}
