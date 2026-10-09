import { useCallback, useState } from 'react'
import { rpc } from '../lib/api'
import { usePolling } from './usePolling'

/** Posiciones propias (acciones + costo promedio calculado en el servidor). */
export function useMyPositions({ interval = 30000, enabled = true } = {}) {
  const [raw, setRaw] = useState(null)
  const fetchPositions = useCallback(async () => {
    const data = await rpc('get_my_portfolio')
    setRaw(data?.positions || [])
  }, [])
  const { refresh } = usePolling(fetchPositions, { interval, enabled })
  return { raw, refresh }
}
