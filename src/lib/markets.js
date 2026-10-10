import { categoryOf } from './categories'
import { yesPrice } from './trading'

/**
 * Separa una lista de mercados en "particulares" y "grupos" (mercados múltiples
 * agrupados por group_topic). Mantiene el orden de entrada.
 */
export function groupMarkets(markets) {
  const particular = []
  const groups = new Map()
  for (const m of markets) {
    if (m.group_topic) {
      if (!groups.has(m.group_topic)) groups.set(m.group_topic, [])
      groups.get(m.group_topic).push(m)
    } else {
      particular.push(m)
    }
  }
  return { particular, groups: [...groups.entries()] }
}

/**
 * Estado de un mercado respecto al reloj:
 *  · upcoming todavía no abre (apertura programada)
 *  · open     se puede operar
 *  · pending  ya pasó la hora de cierre, falta que alguien lo resuelva
 *  · resolved ya tiene resultado
 */
export function marketState(market, nowMs) {
  if (market.closed) return 'resolved'
  if (market.opens_at && nowMs < Date.parse(market.opens_at)) return 'upcoming'
  if (market.closes_at && nowMs >= Date.parse(market.closes_at)) return 'pending'
  return 'open'
}

/** Minúsculas y sin tildes, para que "Música" y "musica" se encuentren. */
export const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

const NEW_MS = 6 * 3600 * 1000

/**
 * Convierte los mercados (cada uno con `state`) en tarjetas del feed: los
 * mercados sueltos son una tarjeta y los mercados múltiples (mismo group_id)
 * se juntan en UNA tarjeta con sus opciones.
 */
export function buildItems(markets, nowMs) {
  const singles = []
  const groups = new Map()
  for (const m of markets) {
    if (m.group_id) {
      if (!groups.has(m.group_id)) groups.set(m.group_id, [])
      groups.get(m.group_id).push(m)
    } else {
      singles.push(m)
    }
  }

  const items = singles.map((m) => ({
    key: `m:${m.id}`,
    kind: 'single',
    id: m.id,
    title: m.question,
    description: m.description,
    market: m,
    markets: [m],
    category: m.category,
    image_url: m.image_url,
    image_thumb_url: m.image_thumb_url,
    image_color: m.image_color,
    created_at: m.created_at,
    closes_at: m.state === 'open' ? m.closes_at : null,
    opens_at: m.state === 'upcoming' ? m.opens_at : null,
    state: m.state,
    resolved_at: m.resolved_at,
    score: Number(m.score) || 0,
    trades_24h: Number(m.trades_24h) || 0,
    trades_total: Number(m.trades_total) || 0,
    isNew: nowMs - Date.parse(m.created_at) < NEW_MS,
  }))

  for (const [groupId, list] of groups) {
    const options = [...list].sort((a, b) => yesPrice(b) - yesPrice(a))
    const first = options[0]
    const open = options.filter((m) => m.state === 'open')
    const upcoming = options.filter((m) => m.state === 'upcoming')
    const pending = options.filter((m) => m.state === 'pending')
    const opensAt = upcoming
      .map((m) => m.opens_at)
      .filter(Boolean)
      .sort()[0]
    const closesAt = open
      .map((m) => m.closes_at)
      .filter(Boolean)
      .sort()[0]
    const resolvedAt = options
      .map((m) => m.resolved_at)
      .filter(Boolean)
      .sort()
      .pop()
    const created = options.map((m) => m.created_at).sort().pop()
    items.push({
      key: `g:${groupId}`,
      kind: 'group',
      id: groupId,
      title: first.group_topic,
      description: first.description,
      market: null,
      markets: options,
      category: first.category,
      image_url: options.find((m) => m.image_url)?.image_url || null,
      image_thumb_url: options.find((m) => m.image_thumb_url)?.image_thumb_url || null,
      image_color: options.find((m) => m.image_color)?.image_color || null,
      created_at: created,
      closes_at: closesAt || null,
      opens_at: open.length ? null : opensAt || null,
      state: open.length ? 'open' : upcoming.length ? 'upcoming' : pending.length ? 'pending' : 'resolved',
      resolved_at: resolvedAt || null,
      score: options.reduce((s, m) => s + (Number(m.score) || 0), 0),
      trades_24h: options.reduce((s, m) => s + (Number(m.trades_24h) || 0), 0),
      trades_total: options.reduce((s, m) => s + (Number(m.trades_total) || 0), 0),
      isNew: nowMs - Date.parse(created) < NEW_MS,
    })
  }
  return items
}

const byDateDesc = (field) => (a, b) => Date.parse(b[field] || 0) - Date.parse(a[field] || 0)

export const SORTS = {
  trending: {
    label: 'Tendencia',
    fn: (a, b) => b.score - a.score || b.trades_total - a.trades_total || byDateDesc('created_at')(a, b),
  },
  active: {
    label: 'Más activos',
    fn: (a, b) => b.trades_24h - a.trades_24h || b.trades_total - a.trades_total || byDateDesc('created_at')(a, b),
  },
  new: { label: 'Nuevos', fn: byDateDesc('created_at') },
  closing: {
    label: 'Cierran pronto',
    fn: (a, b) => {
      const ca = a.closes_at ? Date.parse(a.closes_at) : Infinity
      const cb = b.closes_at ? Date.parse(b.closes_at) : Infinity
      return ca - cb || byDateDesc('created_at')(a, b)
    },
  },
}

export function matchesQuery(item, query) {
  const q = normalize(query).trim()
  if (!q) return true
  const haystack = normalize(
    [item.title, item.description, categoryOf(item.category).label, ...item.markets.map((m) => m.question)].join(' ')
  )
  return q.split(/\s+/).every((word) => haystack.includes(word))
}

/** Mismo criterio que la política RLS del servidor (defensa en profundidad en el cliente). */
export function isVisibleTo(market, profile) {
  if (!profile) return false
  if (profile.is_admin) return true
  const blocked = market.target_users
  return !blocked || blocked.length === 0 || !blocked.includes(profile.id)
}
