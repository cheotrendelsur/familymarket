import { useEffect, useRef, useState } from 'react'

/**
 * Envuelve un texto que cambia (precio, %) y lo hace destellar en verde si subió
 * o en rojo si bajó. `value` debe ser un número ya redondeado (el que se muestra).
 */
export default function PriceFlash({ value, children, className = '' }) {
  const previous = useRef(value)
  const [anim, setAnim] = useState({ key: 0, cls: '' })

  useEffect(() => {
    if (previous.current !== value) {
      setAnim((a) => ({ key: a.key + 1, cls: value > previous.current ? 'animate-flash-up' : 'animate-flash-down' }))
      previous.current = value
    }
  }, [value])

  return (
    <span key={anim.key} className={`${anim.cls} rounded ${className}`}>
      {children}
    </span>
  )
}
