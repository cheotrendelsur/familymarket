import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../../lib/fx'

/**
 * Número que "cuenta" suavemente hasta su nuevo valor. Con `flash` además
 * destella en verde (sube) o rojo (baja) cada vez que cambia.
 *  · `from`: valor inicial distinto al actual (p. ej. 0 en la pantalla de victoria)
 */
export default function AnimatedNumber({
  value,
  from,
  format = (v) => v.toFixed(2),
  duration = 700,
  flash = false,
  delay = 0,
  className = '',
}) {
  const target = Number.isFinite(Number(value)) ? Number(value) : 0
  const [display, setDisplay] = useState(from ?? target)
  const [flashState, setFlashState] = useState({ key: 0, dir: 0 })
  const shown = useRef(from ?? target)
  const previous = useRef(target)
  const raf = useRef(0)

  useEffect(() => {
    if (flash && previous.current !== target) {
      setFlashState((s) => ({ key: s.key + 1, dir: target > previous.current ? 1 : -1 }))
    }
    previous.current = target

    if (prefersReducedMotion() || duration <= 0) {
      shown.current = target
      setDisplay(target)
      return undefined
    }
    const origin = shown.current
    let started = null
    let timer = null
    const step = (t) => {
      if (started === null) started = t
      const p = Math.min(1, (t - started) / duration)
      const eased = 1 - (1 - p) ** 3
      const v = origin + (target - origin) * eased
      shown.current = v
      setDisplay(v)
      if (p < 1) raf.current = requestAnimationFrame(step)
    }
    timer = setTimeout(() => {
      raf.current = requestAnimationFrame(step)
    }, delay)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(raf.current)
    }
  }, [target, duration, delay, flash])

  const flashClass = flashState.dir > 0 ? 'animate-flash-up' : flashState.dir < 0 ? 'animate-flash-down' : ''
  return (
    <span key={flash ? flashState.key : 0} className={`${flash ? `${flashClass} rounded-md` : ''} ${className}`}>
      {format(display)}
    </span>
  )
}
