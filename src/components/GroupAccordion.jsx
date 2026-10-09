import { ChevronDown } from 'lucide-react'

/**
 * Acordeón de "mercado múltiple" (varios submercados bajo un mismo tópico).
 * tone: 'blue' (activos) | 'gray' (cerrados)
 */
export default function GroupAccordion({
  topic,
  count,
  open,
  onToggle,
  tone = 'blue',
  hintOpen = 'Ocultar opciones',
  hintClosed = 'Toca para ver y apostar',
  children,
}) {
  const blue = tone === 'blue'
  return (
    <div
      className={`bg-white border-2 rounded-xl overflow-hidden shadow-sm ${
        blue ? 'border-polyblue/20' : 'border-gray-300 opacity-90 hover:opacity-100'
      }`}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full flex items-center justify-between p-4 transition-colors ${
          blue ? 'bg-blue-50/50 hover:bg-blue-50' : 'bg-gray-100 hover:bg-gray-200'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-10 h-10 text-white rounded-xl flex items-center justify-center font-bold shadow-sm flex-shrink-0 ${
              blue ? 'bg-polyblue' : 'bg-gray-500'
            }`}
          >
            {count}
          </div>
          <div className="text-left min-w-0">
            <h4 className="font-bold text-gray-900 leading-snug">{topic}</h4>
            <p className="text-xs text-gray-500">{open ? hintOpen : hintClosed}</p>
          </div>
        </div>
        <ChevronDown
          size={22}
          className={`flex-shrink-0 transition-transform duration-300 ${blue ? 'text-polyblue' : 'text-gray-500'} ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className={`p-4 border-t-2 space-y-3 ${blue ? 'border-polyblue/10 bg-gray-50/50' : 'border-gray-200 bg-gray-50/50'}`}>
          {children}
        </div>
      )}
    </div>
  )
}
