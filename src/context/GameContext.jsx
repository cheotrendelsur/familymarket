import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { rpc } from '../lib/api'
import { DEFAULT_CONFIG } from '../lib/trading'
import { isVisibleTo } from '../lib/markets'
import { usePolling } from '../hooks/usePolling'
import { useAuth } from './AuthContext'

const GameContext = createContext(null)

// eslint-disable-next-line react-refresh/only-export-components
export const useGame = () => {
  const context = useContext(GameContext)
  if (!context) throw new Error('useGame debe usarse dentro de GameProvider')
  return context
}

const MARKET_COLUMNS =
  'id, question, description, image_url, yes_pool, no_pool, outcome, closed, created_at, resolved_at, group_topic, target_users'

const MARKETS_POLL_MS = 12000
const MARKETS_CALM_POLL_MS = 25000 // si nadie opera durante 2 min, se sondea más despacio
const CALM_AFTER_MS = 120000
const DAILY_POLL_MS = 60000

const signatureOf = (rows) =>
  rows.map((m) => `${m.id}:${m.yes_pool}:${m.no_pool}:${m.closed}:${m.outcome}`).join('|')

/**
 * Estado compartido del juego: configuración, mercados y movimientos diarios.
 * Todas las pantallas leen de aquí, así que cambiar de pestaña no vuelve a
 * descargar nada y solo hay UNA petición periódica por usuario, sin importar
 * cuántas pantallas haya abierto.
 */
export function GameProvider({ children }) {
  const { user, profile } = useAuth()
  const ready = !!user && !!profile?.username

  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [allMarkets, setAllMarkets] = useState([])
  const [marketsLoaded, setMarketsLoaded] = useState(false)
  const [marketsError, setMarketsError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [daily, setDaily] = useState(null) // { used, remaining, limit }
  const [calm, setCalm] = useState(false)
  const signatureRef = useRef('')
  const lastChangeRef = useRef(Date.now())

  // Reinicia todo al cambiar de usuario (evita mezclar datos entre cuentas).
  useEffect(() => {
    if (!user) {
      signatureRef.current = ''
      setAllMarkets([])
      setMarketsLoaded(false)
      setMarketsError(null)
      setDaily(null)
    }
  }, [user])

  // Configuración del juego (fee, límites...) — se lee una vez.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    supabase
      .from('game_settings')
      .select('daily_limit, fee_rate, initial_liquidity, initial_balance, min_price, max_price, min_trade')
      .maybeSingle()
      .then(({ data }) => {
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
    return () => {
      cancelled = true
    }
  }, [ready])

  const fetchMarkets = useCallback(async () => {
    const { data, error } = await supabase
      .from('markets')
      .select(MARKET_COLUMNS)
      .order('created_at', { ascending: false })
    if (error) {
      setMarketsError(error.message)
      throw error
    }
    setMarketsError(null)
    setLastUpdated(Date.now())
    const next = data || []
    const signature = signatureOf(next)
    if (signature !== signatureRef.current) {
      signatureRef.current = signature
      lastChangeRef.current = Date.now()
      setAllMarkets(next)
      setCalm(false)
    } else if (Date.now() - lastChangeRef.current > CALM_AFTER_MS) {
      setCalm(true)
    }
    setMarketsLoaded(true)
  }, [])

  const fetchDaily = useCallback(async () => {
    const data = await rpc('get_daily_moves')
    if (data) setDaily({ used: data.used, remaining: data.remaining, limit: data.limit })
  }, [])

  const { refresh: refreshMarkets } = usePolling(fetchMarkets, {
    interval: calm ? MARKETS_CALM_POLL_MS : MARKETS_POLL_MS,
    enabled: ready,
  })
  const { refresh: refreshDaily } = usePolling(fetchDaily, { interval: DAILY_POLL_MS, enabled: ready })

  // Aplica el resultado de una operación (nuevas piscinas + movimientos restantes) sin esperar al sondeo.
  const applyTradeResult = useCallback((marketId, result) => {
    if (result?.yes_pool !== undefined && result?.no_pool !== undefined) {
      setAllMarkets((prev) =>
        prev.map((m) =>
          m.id === marketId ? { ...m, yes_pool: String(result.yes_pool), no_pool: String(result.no_pool) } : m
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
  }, [config.daily_limit])

  const markets = useMemo(() => allMarkets.filter((m) => isVisibleTo(m, profile)), [allMarkets, profile])
  const activeMarkets = useMemo(() => markets.filter((m) => !m.closed), [markets])
  const closedMarkets = useMemo(
    () =>
      markets
        .filter((m) => m.closed)
        .sort((a, b) => new Date(b.resolved_at || b.created_at) - new Date(a.resolved_at || a.created_at)),
    [markets]
  )

  const value = useMemo(
    () => ({
      config,
      markets,
      activeMarkets,
      closedMarkets,
      marketsLoaded,
      marketsError,
      lastUpdated,
      daily,
      refreshMarkets,
      refreshDaily,
      applyTradeResult,
    }),
    [config, markets, activeMarkets, closedMarkets, marketsLoaded, marketsError, lastUpdated, daily, refreshMarkets, refreshDaily, applyTradeResult]
  )

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}
