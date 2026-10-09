import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useExitTransition } from '../../hooks/useExitTransition'

let lockCount = 0
function lockScroll() {
  if (lockCount === 0) document.body.style.overflow = 'hidden'
  lockCount += 1
  return () => {
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount === 0) document.body.style.overflow = ''
  }
}

/**
 * Hoja inferior (bottom sheet) con animación de entrada/salida y arrastre hacia
 * abajo para cerrar. Se dibuja en un portal por encima de todo.
 */
export default function Sheet({ open, onClose, title, subtitle, children, footer, z = 'z-50', labelledBy }) {
  const { mounted, closing } = useExitTransition(open, 220)
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startY = useRef(null)

  useEffect(() => {
    if (!mounted) return undefined
    const unlock = lockScroll()
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      unlock()
      window.removeEventListener('keydown', onKey)
    }
  }, [mounted, onClose])

  if (!mounted) return null

  const onTouchStart = (e) => {
    startY.current = e.touches[0].clientY
    setDragging(true)
  }
  const onTouchMove = (e) => {
    if (startY.current === null) return
    setDy(Math.max(0, e.touches[0].clientY - startY.current))
  }
  const onTouchEnd = () => {
    setDragging(false)
    if (dy > 110) onClose?.()
    setDy(0)
    startY.current = null
  }

  return createPortal(
    <div className={`fixed inset-0 ${z}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div
        className={`absolute inset-0 bg-slate-900/45 backdrop-blur-[2px] ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 flex justify-center pointer-events-none">
        <div
          className={`pointer-events-auto w-full max-w-lg bg-white rounded-t-3xl shadow-sheet flex flex-col max-h-[92vh] supports-[height:1dvh]:max-h-[92dvh] ${
            closing ? 'animate-sheet-out' : 'animate-sheet-in'
          }`}
          style={{ transform: dy ? `translateY(${dy}px)` : undefined, transition: dragging ? 'none' : 'transform 0.2s ease' }}
        >
          <div
            className="flex-shrink-0 touch-none relative"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <div className="flex justify-center pt-2.5 pb-1">
              <div className="w-10 h-1.5 rounded-full bg-gray-300" />
            </div>
            {!title && !subtitle && (
              <button
                onClick={onClose}
                className="absolute right-3 top-2 p-2 rounded-full hover:bg-gray-100 z-10"
                aria-label="Cerrar"
              >
                <X size={20} className="text-gray-400" />
              </button>
            )}
            {(title || subtitle) && (
              <div className="px-5 pb-3 pt-1 flex items-start justify-between gap-3 border-b border-gray-100">
                <div className="min-w-0">
                  {subtitle && <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">{subtitle}</p>}
                  {title && (
                    <h2 id={labelledBy} className="font-bold text-gray-900 leading-snug">
                      {title}
                    </h2>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="p-2 -mr-2 -mt-1 rounded-full hover:bg-gray-100 flex-shrink-0"
                  aria-label="Cerrar"
                >
                  <X size={22} className="text-gray-500" />
                </button>
              </div>
            )}
          </div>
          <div className="overflow-y-auto scrollable-container flex-1 px-5 py-4">{children}</div>
          {footer && <div className="flex-shrink-0 border-t border-gray-100 px-5 py-3 safe-bottom">{footer}</div>}
          {!footer && <div className="flex-shrink-0 safe-bottom" />}
        </div>
      </div>
    </div>,
    document.body
  )
}
