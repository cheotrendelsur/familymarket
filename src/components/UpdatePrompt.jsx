import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { applyUpdate, subscribeUpdate } from '../lib/pwa'

/** Banner "Hay una versión nueva" sobre la barra inferior. Nunca recarga solo. */
export default function UpdatePrompt() {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => subscribeUpdate(setAvailable), [])
  if (!available) return null

  return (
    <div
      className="fixed inset-x-0 z-[60] flex justify-center px-4 animate-slide-up"
      style={{ bottom: 'calc(68px + env(safe-area-inset-bottom))' }}
      role="status"
    >
      <div className="w-full max-w-md bg-gray-900 text-white rounded-2xl shadow-lift flex items-center gap-3 pl-4 pr-2 py-2">
        <RefreshCw size={18} className="text-emerald-400 flex-shrink-0" />
        <p className="flex-1 text-sm font-medium leading-snug">Hay una versión nueva de FamilyMarket</p>
        <button
          onClick={() => {
            setBusy(true)
            applyUpdate()
          }}
          disabled={busy}
          className="bg-white text-gray-900 font-bold text-sm px-4 py-2 rounded-xl disabled:opacity-60"
        >
          {busy ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>
    </div>
  )
}
