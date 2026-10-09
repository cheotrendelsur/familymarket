import { useEffect, useState } from 'react'

/**
 * Mantiene montado un componente durante su animación de salida.
 * `open` true -> montado; al pasar a false sigue montado `ms` más (closing=true).
 */
export function useExitTransition(open, ms = 220) {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return undefined
    }
    if (!mounted) return undefined
    setClosing(true)
    const id = setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, ms)
    return () => clearTimeout(id)
  }, [open, ms, mounted])

  return { mounted, closing }
}
