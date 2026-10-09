import { useCallback, useEffect, useState } from 'react'
import { rpc } from '../lib/api'
import { usePolling } from './usePolling'

/** Últimos movimientos (compras, ventas, mercados nuevos y resueltos) con sondeo liviano. */
export function useActivity({ limit = 20, marketId = null, groupId = null, interval = 20000, enabled = true } = {}) {
  const [events, setEvents] = useState(null)

  const fetchActivity = useCallback(async () => {
    const data = await rpc('get_recent_activity', {
      p_limit: limit,
      p_market_id: marketId,
      p_group_id: groupId,
    })
    setEvents(data || [])
  }, [limit, marketId, groupId])

  useEffect(() => {
    setEvents(null)
  }, [marketId, groupId])

  const { refresh } = usePolling(fetchActivity, { interval, enabled })
  return { events, refresh }
}
