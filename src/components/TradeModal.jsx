import { useEffect } from 'react'
import { X } from 'lucide-react'
import TradePanel from './TradePanel'

/** Hoja inferior con el panel de operaciones (se abre desde las tarjetas de Home). */
export default function TradeModal({ market, side, onClose }) {
  // Bloquea el scroll de fondo mientras está abierto y permite cerrar con Escape.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto scrollable-container"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-start justify-between gap-3 rounded-t-2xl z-10">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Operar</p>
            <h2 className="font-bold text-gray-900 leading-snug">{market.question}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg flex-shrink-0" aria-label="Cerrar">
            <X size={24} className="text-gray-600" />
          </button>
        </div>
        <div className="p-6">
          <TradePanel market={market} side={side} onDone={onClose} />
        </div>
      </div>
    </div>
  )
}
