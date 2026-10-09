import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, ChevronDown } from 'lucide-react'
import { CATEGORIES } from '../../lib/categories'
import { serverNow } from '../../lib/clock'
import { closesLabel, fromLocalInput, toLocalInput } from '../../lib/time'

export const inputClass =
  'w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-polyblue focus:ring-4 focus:ring-polyblue/10 outline-none transition bg-white'

export function Field({ label, hint, children }) {
  return (
    <div>
      {label && <label className="block text-sm font-bold text-gray-700 mb-1.5">{label}</label>}
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

export function Notice({ tone = 'ok', children }) {
  const styles = tone === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-800'
  const Icon = tone === 'error' ? AlertCircle : CheckCircle
  return (
    <div className={`p-3.5 border rounded-xl flex items-start gap-3 ${styles}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={19} className="flex-shrink-0 mt-0.5" />
      <p className="text-sm flex-1">{children}</p>
    </div>
  )
}

export function Card({ title, subtitle, icon, tone = 'bg-polyblue', children, danger = false }) {
  return (
    <div className={`bg-white rounded-3xl border shadow-card p-5 ${danger ? 'border-red-200' : 'border-gray-200'}`}>
      {title && (
        <div className="flex items-center gap-3 mb-4">
          {icon && <div className={`w-11 h-11 ${tone} rounded-2xl flex items-center justify-center shadow-lg text-white`}>{icon}</div>}
          <div>
            <h2 className="text-lg font-extrabold text-gray-900 leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          </div>
        </div>
      )}
      {children}
    </div>
  )
}

/** Sección plegable: lo poco usado queda a un toque, pero no estorba. */
export function Disclosure({ title, hint, defaultOpen = false, children, danger = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`bg-white rounded-2xl border shadow-card overflow-hidden ${danger ? 'border-red-200' : 'border-gray-200'}`}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left">
        <span className="min-w-0">
          <span className={`block font-bold ${danger ? 'text-red-700' : 'text-gray-900'}`}>{title}</span>
          {hint && <span className="block text-xs text-gray-500">{hint}</span>}
        </span>
        <ChevronDown size={20} className={`text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 animate-fade-in">{children}</div>}
    </div>
  )
}

export function Switch({ on, onChange, label, hint, compact = false }) {
  return (
    <div className={`flex items-center justify-between ${compact ? '' : 'bg-gray-50 p-3.5 rounded-2xl'}`}>
      <div className="pr-3 min-w-0">
        <p className="font-bold text-gray-900 text-sm">{label}</p>
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!on)}
        aria-pressed={on}
        aria-label={label}
        className={`w-14 h-8 flex-shrink-0 flex items-center rounded-full p-1 transition-colors ${on ? 'bg-polyblue' : 'bg-gray-300'}`}
      >
        <span className={`bg-white w-6 h-6 rounded-full shadow transition-transform ${on ? 'translate-x-6' : ''}`} />
      </button>
    </div>
  )
}

/** Categorías en una sola fila deslizable (ocupa poco en el celular). */
export function CategoryPicker({ value, onChange }) {
  return (
    <div className="-mx-1 px-1 overflow-x-auto scrollbar-hide">
      <div className="flex gap-2 w-max pr-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            aria-pressed={value === c.id}
            className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-sm font-semibold border transition-colors flex-shrink-0 ${
              value === c.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            <span>{c.emoji}</span> {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const inMinutes = (m) => new Date(serverNow() + m * 60000)
const todayAt = (h) => {
  const d = new Date(serverNow())
  d.setHours(h, 0, 0, 0)
  return d
}
const tomorrowAt = (h) => {
  const d = todayAt(h)
  d.setDate(d.getDate() + 1)
  return d
}

/** Fecha y hora de cierre con atajos. Vacío = el mercado no cierra solo. */
export function ClosesAtField({ value, onChange }) {
  const [custom, setCustom] = useState(false)
  const presets = useMemo(
    () => [
      ['En 30 min', () => inMinutes(30)],
      ['En 2 horas', () => inMinutes(120)],
      ['Hoy 8 pm', () => todayAt(20)],
      ['Mañana 8 pm', () => tomorrowAt(20)],
      ['En 3 días', () => inMinutes(3 * 24 * 60)],
    ],
    []
  )
  const iso = fromLocalInput(value)
  return (
    <div className="space-y-2.5">
      <div className="-mx-1 px-1 overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 w-max pr-2">
          <button
            type="button"
            onClick={() => {
              onChange('')
              setCustom(false)
            }}
            aria-pressed={!value}
            className={`px-3.5 py-2 rounded-full text-sm font-semibold flex-shrink-0 border ${!value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}
          >
            Sin fecha
          </button>
          {presets.map(([label, make]) => (
            <button
              key={label}
              type="button"
              onClick={() => onChange(toLocalInput(make().toISOString()))}
              className="px-3.5 py-2 rounded-full bg-white border border-gray-200 text-sm font-semibold text-gray-600 flex-shrink-0"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCustom(!custom)}
            aria-expanded={custom}
            className="px-3.5 py-2 rounded-full bg-white border border-gray-200 text-sm font-semibold text-polyblue flex-shrink-0"
          >
            Otra fecha…
          </button>
        </div>
      </div>
      {custom && <input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />}
      <p className="text-xs text-gray-500">
        {iso
          ? `Las apuestas cierran el ${closesLabel(iso)}. Después queda «esperando resultado».`
          : 'Sin fecha: el mercado sigue abierto hasta que alguien lo resuelva.'}
      </p>
    </div>
  )
}
