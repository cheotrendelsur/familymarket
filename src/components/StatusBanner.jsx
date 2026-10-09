import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { useGame } from '../context/GameContext'

/** Aviso discreto cuando no se pueden actualizar los datos (sin internet / servidor saturado). */
export default function StatusBanner() {
  const { lastUpdated, marketsError } = useGame()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  const stale = lastUpdated && now - lastUpdated > 45000
  if (!offline && !marketsError && !stale) return null

  const seconds = lastUpdated ? Math.round((now - lastUpdated) / 1000) : null
  return (
    <div className="sticky top-16 z-30 bg-amber-100 border-b border-amber-300 text-amber-900 text-sm px-4 py-2 flex items-center justify-center gap-2" role="status">
      <WifiOff size={16} />
      <span>
        {offline ? 'Sin conexión' : 'Reconectando…'}
        {seconds !== null && ` · datos de hace ${seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)} min`}`}
      </span>
    </div>
  )
}
