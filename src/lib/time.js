// Cuenta regresiva y fechas legibles (es-VE).

const pad = (n) => String(n).padStart(2, '0')

/** ms restantes -> { d, h, m, s, text, urgent } */
export function countdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  let text
  if (d >= 2) text = `${d}d ${h}h`
  else if (d === 1) text = `1d ${h}h`
  else if (h >= 1) text = `${h}h ${pad(m)}m`
  else if (m >= 1) text = `${m}m ${pad(s)}s`
  else text = `${s}s`
  return { d, h, m, s, text, total, urgent: total < 3600 }
}

/** "sáb 12 · 6:00 p. m." */
export function closesLabel(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  const day = date.toLocaleDateString('es-VE', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = date.toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time}`
}

/** "hace 5 min", "hace 2 h", "ayer"... */
export function timeAgo(iso, nowMs = Date.now()) {
  if (!iso) return ''
  const diff = Math.max(0, nowMs - new Date(iso).getTime()) / 1000
  if (diff < 45) return 'ahora'
  if (diff < 3600) return `hace ${Math.round(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.round(diff / 3600)} h`
  if (diff < 172800) return 'ayer'
  return new Date(iso).toLocaleDateString('es-VE', { day: 'numeric', month: 'short' })
}

/** Valor para <input type="datetime-local"> a partir de un ISO (hora local). */
export function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** <input type="datetime-local"> -> ISO UTC (o null). */
export function fromLocalInput(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
