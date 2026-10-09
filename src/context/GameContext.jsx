import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { db, rpc } from '../lib/api'
import { serverNow, setServerOffset } from '../lib/clock'
import { DEFAULT_CONFIG } from '../lib/trading'
import { buildItems, marketState } from '../lib/markets'
import { usePolling } from '../hooks/usePolling'
import { useAuth } from './AuthContext'

const GameContext = createContext(null)

// eslint-disable-next-line react-refresh/only-export-components
export const useGame = () => {
  const context = useContext(GameContext)
  if (!context) throw new Error('useGame debe usarse dentro de GameProvider')
  return context
}

const PRICES_POLL_MS = 12000
const PRICES_CALM_POLL_MS = 25000 // si nadie opera durante 2 min, se sondea más despacio
const CALM_AFTER_MS = 120000
const SESSION_POLL_MS = 15000

const signatureOf = (rows) =>
  rows
    .map(
      (r) =>
        `${r.id}:${r.yes_pool}:${r.no_pool}:${r.closed}:${r.outcome}:${r.closes_at}:${r.static_rev}:${r.trades_24h}:${r.traders_24h}:${r.trades_total}`
    )
    .join('|')

/**
 * Estado compartido del juego. Dos niveles de sondeo para gastar poco:
 *  · get_market_prices  (ligero, cada ~12 s): solo piscinas/estado de cada mercado.
 *  · textos, fotos, categoría... se descargan UNA vez y solo se vuelven a bajar
 *    cuando el servidor avisa (static_rev) de que ese mercado cambió.
 *  · get_session_state (cada ~15 s): movimientos del día, hora del servidor y
 *    avisos pendientes (victorias, derrotas, sugerencias...).
 */
export function GameProvider({ children }) {
  const { user, profile, isStaff } = useAuth()
  const ready = !!user && !!profile?.username

  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [prices, setPrices] = useState([])
  const [staticsVersion, setStaticsVersion] = useState(0)
  const [marketsLoaded, setMarketsLoaded] = useState(false)
  const [marketsError, setMarketsError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [daily, setDaily] = useState(null) // { used, remaining, limit }
  const [pendingSuggestions, setPendingSuggestions] = useState(null)
  const [celebrations, setCelebrations] = useState([])
  const [calm, setCalm] = useState(false)
  const [tick, setTick] = useState(() => serverNow())

  const staticsRef = useRef(new Map())
  const signatureRef = useRef('')
  const lastChangeRef = useRef(Date.now())
  const closedRef = useRef(new Map())
  const notifiedRef = useRef(new Set())
  const staffRef = useRef(isStaff)
  staffRef.current = isStaff

  // Reinicia todo al cambiar de usuario (evita mezclar datos entre cuentas).
  useEffect(() => {
    if (!user) {
      staticsRef.current = new Map()
      closedRef.current = new Map()
      notifiedRef.current = new Set()
      signatureRef.current = ''
      setPrices([])
      setStaticsVersion((v) => v + 1)
      setMarketsLoaded(false)
      setMarketsError(null)
      setDaily(null)
      setPendingSuggestions(null)
      setCelebrations([])
    }
  }, [user])

  // Configuración del juego (fee, límites...) — se lee una vez.
  useEffect(() => {
    if (!ready) return undefined
    let cancelled = false
    db.gameSettings()
      .then((data) => {
        if (cancelled || !data) return
        setConfig({
          daily_limit: Number(data.daily_limit),
          fee_rate: Number(data.fee_rate),
          initial_liquidity: Number(data.initial_liquidity),
          initial_balance: Number(data.initial_balance),
          min_price: Number(data.min_price),
          max_price: Number(data.max_price),
          min_trade: Number(data.min_trade),
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ready])

  // ---------------------------------------------------------------- sesión
  const enqueueNotifications = useCallback((list) => {
    const fresh = list.filter((n) => !notifiedRef.current.has(n.id))
    if (!fresh.length) return
    fresh.forEach((n) => notifiedRef.current.add(n.id))
    setCelebrations((prev) => [...prev, ...fresh])
  }, [])

  const fetchSession = useCallback(async () => {
    const startedAt = Date.now()
    const s = await rpc('get_session_state')
    if (!s) return
    setServerOffset(s.server_now, startedAt)
    setDaily({ used: s.daily.used, remaining: s.daily.remaining, limit: s.daily.limit })
    setPendingSuggestions(s.pending_suggestions ?? null)
    if (s.notifications?.length) enqueueNotifications(s.notifications)
  }, [enqueueNotifications])

  const { refresh: refreshSession } = usePolling(fetchSession, { interval: SESSION_POLL_MS, enabled: ready })

  const dismissCelebration = useCallback((id) => {
    setCelebrations((prev) => prev.filter((n) => n.id !== id))
    rpc('mark_notifications_seen', { p_ids: [id] }).catch(() => {})
  }, [])

  // ---------------------------------------------------------------- mercados
  const fetchPrices = useCallback(async () => {
    let rows
    try {
      rows = await rpc('get_market_prices')
    } catch (error) {
      setMarketsError(error.message || 'Error')
      throw error
    }
    rows = rows || []
    setMarketsError(null)
    setLastUpdated(Date.now())

    const signature = signatureOf(rows)
    if (signature !== signatureRef.current) {
      signatureRef.current = signature
      lastChangeRef.current = Date.now()
      setPrices(rows)
      setCalm(false)
    } else if (Date.now() - lastChangeRef.current > CALM_AFTER_MS) {
      setCalm(true)
    }

    // ¿Algún mercado acaba de resolverse? Pide los avisos ya, sin esperar al siguiente sondeo.
    let justClosed = false
    for (const r of rows) {
      if (closedRef.current.get(r.id) === false && r.closed) justClosed = true
      closedRef.current.set(r.id, r.closed)
    }

    // Descarga solo los mercados nuevos o cuyos textos/fotos cambiaron.
    const statics = staticsRef.current
    const need = []
    const seen = new Set()
    let changed = false
    for (const r of rows) {
      seen.add(r.id)
      const s = statics.get(r.id)
      if (!s || s._rev !== r.static_rev || s._closed !== r.closed) need.push(r)
    }
    for (const id of [...statics.keys()]) {
      if (!seen.has(id)) {
        statics.delete(id)
        closedRef.current.delete(id)
        changed = true
      }
    }
    if (need.length) {
      const fresh = await db.marketsByIds(
        need.map((r) => r.id),
        { withTargets: staffRef.current }
      )
      const byId = new Map(need.map((r) => [r.id, r]))
      for (const row of fresh) {
        const r = byId.get(row.id)
        statics.set(row.id, { ...row, _rev: r.static_rev, _closed: r.closed })
      }
      changed = true
    }
    if (changed) setStaticsVersion((v) => v + 1)
    setMarketsLoaded(true)
    if (justClosed) refreshSession()
  }, [refreshSession])

  const { refresh: refreshMarkets } = usePolling(fetchPrices, {
    interval: calm ? PRICES_CALM_POLL_MS : PRICES_POLL_MS,
    enabled: ready,
  })

  // Cuando se acerca la hora de cierre de algún mercado, recalcula justo en ese momento.
  useEffect(() => {
    const now = serverNow()
    let next = Infinity
    for (const p of prices) {
      if (p.closed || !p.closes_at) continue
      const t = Date.parse(p.closes_at)
      if (t > now && t < next) next = t
    }
    const delay = Math.min(next === Infinity ? 60000 : next - now + 300, 60000)
    const id = setTimeout(() => setTick(serverNow()), Math.max(delay, 300))
    return () => clearTimeout(id)
  }, [prices, tick])

  // Aplica el resultado de una operación (nuevas piscinas + movimientos restantes) sin esperar al sondeo.
  const applyTradeResult = useCallback(
    (marketId, result) => {
      if (result?.yes_pool !== undefined && result?.no_pool !== undefined) {
        setPrices((prev) =>
          prev.map((p) =>
            p.id === marketId ? { ...p, yes_pool: String(result.yes_pool), no_pool: String(result.no_pool) } : p
          )
        )
        signatureRef.current = ''
        lastChangeRef.current = Date.now()
        setCalm(false)
      }
      if (typeof result?.daily_moves_remaining === 'number') {
        setDaily((prev) => {
          const limit = prev?.limit ?? config.daily_limit
          return { limit, remaining: result.daily_moves_remaining, used: limit - result.daily_moves_remaining }
        })
      }
    },
    [config.daily_limit]
  )

  const markets = useMemo(() => {
    const statics = staticsRef.current
    const out = []
    for (const p of prices) {
      const s = statics.get(p.id)
      if (!s) continue
      const merged = {
        ...s,
        yes_pool: p.yes_pool,
        no_pool: p.no_pool,
        closed: p.closed,
        outcome: p.outcome,
        closes_at: p.closes_at,
        trades_24h: p.trades_24h,
        traders_24h: p.traders_24h,
        trades_total: p.trades_total,
        score: p.score,
        yes_price_24h: p.yes_price_24h,
      }
      merged.state = marketState(merged, tick)
      out.push(merged)
    }
    return out
    // staticsVersion cambia cuando staticsRef recibe datos nuevos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices, staticsVersion, tick])

  const marketsById = useMemo(() => new Map(markets.map((m) => [m.id, m])), [markets])
  const items = useMemo(() => buildItems(markets, tick), [markets, tick])
  const itemsByKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items])
  const activeItems = useMemo(() => items.filter((i) => i.state !== 'resolved'), [items])
  const resolvedItems = useMemo(
    () =>
      items
        .filter((i) => i.state === 'resolved')
        .sort((a, b) => Date.parse(b.resolved_at || b.created_at) - Date.parse(a.resolved_at || a.created_at)),
    [items]
  )

  const value = useMemo(
    () => ({
      config,
      markets,
      marketsById,
      items,
      itemsByKey,
      activeItems,
      resolvedItems,
      marketsLoaded,
      marketsError,
      lastUpdated,
      daily,
      pendingSuggestions,
      celebrations,
      now: tick,
      dismissCelebration,
      refreshMarkets,
      refreshSession,
      applyTradeResult,
    }),
    [
      config,
      markets,
      marketsById,
      items,
      itemsByKey,
      activeItems,
      resolvedItems,
      marketsLoaded,
      marketsError,
      lastUpdated,
      daily,
      pendingSuggestions,
      celebrations,
      tick,
      dismissCelebration,
      refreshMarkets,
      refreshSession,
      applyTradeResult,
    ]
  )

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}
