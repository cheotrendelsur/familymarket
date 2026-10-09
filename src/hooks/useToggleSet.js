import { useCallback, useState } from 'react'

/**
 * Mapa de claves abiertas/cerradas (acordeones).
 * Devuelve [open, toggle(key), setKey(key, value)].
 */
export function useToggleSet() {
  const [open, setOpen] = useState({})
  const toggle = useCallback((key) => setOpen((prev) => ({ ...prev, [key]: !prev[key] })), [])
  const setKey = useCallback((key, value) => setOpen((prev) => ({ ...prev, [key]: value })), [])
  return [open, toggle, setKey]
}
