import { useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { haptic, HAPTIC, playSound } from '../lib/fx'

/**
 * Si estás mirando un mercado justo cuando llega su hora de cierre, cae un aviso
 * "Apuestas cerradas" con un candado que encaja. `state` es el estado del mercado.
 */
export default function ClosingBanner({ state }) {
  const previous = useRef(state)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (previous.current === 'open' && state === 'pending') {
      setShow(true)
      haptic(HAPTIC.close)
      playSound('close')
      const id = setTimeout(() => setShow(false), 3200)
      previous.current = state
      return () => clearTimeout(id)
    }
    previous.current = state
    return undefined
  }, [state])

  if (!show) return null
  return (
    <div
      className="fixed inset-x-0 z-[55] flex justify-center px-4 pointer-events-none"
      style={{ top: 'calc(64px + env(safe-area-inset-top))' }}
      role="status"
    >
      <div className="bg-gray-900 text-white rounded-2xl shadow-lift px-5 py-3.5 flex items-center gap-3 animate-card-in">
        <span className="w-10 h-10 rounded-full bg-amber-400 text-gray-900 flex items-center justify-center">
          <Lock size={20} className="animate-lock-snap" />
        </span>
        <div>
          <p className="font-extrabold leading-tight">¡Apuestas cerradas!</p>
          <p className="text-xs text-gray-300">Ahora solo falta el resultado</p>
        </div>
      </div>
    </div>
  )
}
