import { useMemo } from 'react'
import { AlertCircle, CheckCircle } from 'lucide-react'
import { CATEGORIES } from '../../lib/categories'
import { serverNow } from '../../lib/clock'
import { closesLabel, fromLocalInput, toLocalInput } from '../../lib/time'

export const inputClass =
  'w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-polyblue focus:ring-4 focus:ring-polyblue/10 outline-none transition bg-white'

export function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-bold text-gray-700 mb-1.5">{label}</label>
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

export function Switch({ on, onChange, label, hint }) {
  return (
    <div className="flex items-center justify-between bg-gray-50 p-3.5 rounded-2xl">
      <div className="pr-3">
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

export function CategoryPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORIES.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          aria-pressed={value === c.id}
          className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-sm font-semibold border transition-colors ${
            value === c.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'
          }`}
        >
          <span>{c.emoji}</span> {c.label}
        </button>
      ))}
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
      <div className="flex flex-wrap gap-2">
        {presets.map(([label, make]) => (
          <button
            key={label}
            type="button"
            onClick={() => onChange(toLocalInput(make().toISOString()))}
            className="px-3 py-1.5 rounded-full bg-gray-100 text-sm font-semibold text-gray-700"
          >
            {label}
          </button>
        ))}
        {value && (
          <button type="button" onClick={() => onChange('')} className="px-3 py-1.5 rounded-full text-sm font-bold text-red-500">
            Sin fecha
          </button>
        )}
      </div>
      <input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      <p className="text-xs text-gray-400">
        {iso
          ? `Se cerrarán las apuestas el ${closesLabel(iso)} (hora de tu celular). Después queda «esperando resultado».`
          : 'Sin fecha: el mercado sigue abierto hasta que alguien lo resuelva.'}
      </p>
    </div>
  )
}
