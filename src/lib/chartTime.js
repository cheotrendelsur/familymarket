// Eje de tiempo "bonito" para las gráficas: marcas en horas/días redondos (hora local) en vez de repartir
// el rango en 4 pedazos iguales (que daba etiquetas como 10:37 · 11:07 · 11:37).
const MIN = 60e3
const H = 3600e3
const D = 24 * H
const STEPS = [5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, H, 2 * H, 3 * H, 6 * H, 12 * H, D, 2 * D, 7 * D]

const time = (t) => new Date(t).toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit' })
const hour = (t) => new Date(t).toLocaleTimeString('es-VE', { hour: 'numeric' })
const day = (t) => new Date(t).toLocaleDateString('es-VE', { day: 'numeric', month: 'short' })
const weekdayHour = (t) => `${new Date(t).toLocaleDateString('es-VE', { weekday: 'short' })} ${hour(t)}`

/**
 * Marcas del eje X para el intervalo [min, max] (ms). Devuelve `{ domain, ticks, format }`:
 * a lo sumo ~4 marcas, alineadas a la hora local, y un formateador adecuado al tamaño del rango.
 */
export function timeAxis(min, max, target = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    const t = Number.isFinite(min) ? min : Date.now()
    return { domain: [t, t + H], ticks: [t], format: time }
  }
  const span = max - min
  const step = STEPS.find((s) => span / s <= target) ?? STEPS[STEPS.length - 1]
  const off = -new Date(min).getTimezoneOffset() * MIN // ms que hay que sumar a UTC para tener la hora local
  const first = Math.ceil((min + off) / step) * step - off
  let ticks = []
  for (let t = first; t <= max; t += step) ticks.push(t)
  if (ticks.length < 2) ticks = [min, max]

  let format
  if (step >= D) format = day
  else if (span > 20 * H) format = weekdayHour
  else if (step >= H) format = hour
  else format = time
  return { domain: [min, max], ticks, format }
}

const MONEY_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000]

/**
 * Eje Y en dinero con marcas redondas: dado el mínimo y el máximo de los datos (con un respiro), devuelve
 * `{ domain, ticks }` con pasos como $20, $50, $100… (nunca marcas raras como $983 · $1,023).
 */
export function moneyScale(lo, hi, target = 4) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { domain: [0, 1], ticks: [0, 1] }
  const span = Math.max(hi - lo, 1)
  const step = MONEY_STEPS.find((s) => span / s <= target) ?? MONEY_STEPS[MONEY_STEPS.length - 1]
  const a = Math.max(Math.floor(lo / step) * step, 0)
  const b = Math.max(Math.ceil(hi / step) * step, a + step)
  const ticks = []
  for (let v = a; v <= b + step / 2; v += step) ticks.push(v)
  return { domain: [a, b], ticks }
}

export const fullTime = (t) =>
  new Date(t).toLocaleString('es-VE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
