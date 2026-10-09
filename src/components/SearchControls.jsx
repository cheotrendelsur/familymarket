import { Search, X } from 'lucide-react'
import { CATEGORIES } from '../lib/categories'
import { SORTS } from '../lib/markets'

export function SearchBar({ value, onChange, placeholder = 'Buscar mercados…' }) {
  return (
    <div className="relative">
      <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Buscar mercados"
        autoComplete="off"
        enterKeyHint="search"
        className="w-full h-11 pl-10 pr-10 rounded-2xl bg-white border border-gray-200 focus:border-polyblue focus:ring-4 focus:ring-polyblue/10 outline-none transition"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-gray-100 text-gray-500"
          aria-label="Borrar búsqueda"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

/** Fila de categorías con desplazamiento horizontal (como Polymarket). */
export function CategoryChips({ value, onChange, counts = {} }) {
  const chip = (id, label, emoji) => {
    const active = value === id
    const count = counts[id]
    return (
      <button
        key={id}
        onClick={() => onChange(id)}
        aria-pressed={active}
        className={`flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-sm font-semibold border transition-colors ${
          active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
        }`}
      >
        {emoji && <span aria-hidden="true">{emoji}</span>}
        {label}
        {count > 0 && id !== 'all' && <span className={`text-xs ${active ? 'text-gray-300' : 'text-gray-400'}`}>{count}</span>}
      </button>
    )
  }
  return (
    <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide">
      <div className="flex gap-2 w-max pr-4">
        {chip('all', 'Todos', null)}
        {CATEGORIES.filter((c) => counts[c.id] > 0 || value === c.id).map((c) => chip(c.id, c.label, c.emoji))}
      </div>
    </div>
  )
}

export function SortTabs({ value, onChange }) {
  return (
    <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide">
      <div className="flex gap-1 w-max pr-4 border-b border-gray-200 min-w-full">
        {Object.entries(SORTS).map(([id, s]) => {
          const active = value === id
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              aria-pressed={active}
              className={`relative flex-shrink-0 px-3 py-2.5 text-sm font-semibold transition-colors ${
                active ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {s.label}
              <span
                className={`absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-gray-900 transition-transform origin-center ${
                  active ? 'scale-x-100' : 'scale-x-0'
                }`}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
