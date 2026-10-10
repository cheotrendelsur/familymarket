// Backend de demostración EN MEMORIA (solo desarrollo: http://localhost:5173/?mock=1).
// Imita las funciones RPC reales con datos de ejemplo para revisar la interfaz sin tocar
// la base de datos. No se incluye en el bundle de producción.
import { DEFAULT_CONFIG, quoteBuy, quoteSell, spotPrice } from '../lib/trading'

const delay = (ms = 90 + Math.random() * 140) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now()
const iso = (t) => new Date(t).toISOString()
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))
const min = (n) => n * 60000
const hour = (n) => n * 3600000

const ROLE = (() => {
  try {
    const r = new URLSearchParams(window.location.search).get('role')
    if (r) window.sessionStorage.setItem('fm_mock_role', r)
    return window.sessionStorage.getItem('fm_mock_role') || 'owner'
  } catch {
    return 'owner'
  }
})()

// ------------------------------------------------------------------ datos
const NAMES = ['Cheche', 'MariChris', 'Tomas_christiansen', 'Juampisss', 'Ricky', 'Anagaby', 'Plemecho', 'Carluchooo', 'Yudrexi']
const players = NAMES.map((username, i) => ({
  id: i === 0 ? 'me' : `p${i}`,
  username,
  balance: i === 0 ? 1000 : 1000 + (i * 37 - 140),
  is_admin: i === 0 && ROLE === 'owner',
  is_moderator: (i === 0 && ROLE === 'mod') || i === 2,
  created_at: iso(now() - hour(24 * 40)),
}))
const me = players[0]
const byId = (id) => players.find((p) => p.id === id)
const invites = [
  { email: 'abuela.rosa@gmail.com', password_ok: false, note: null, created_at: iso(now() - hour(5)), username: null, joined: false },
  { email: 'primo.luis@hotmail.com', password_ok: true, note: null, created_at: iso(now() - hour(3)), username: null, joined: false },
]

const svg = (a, b, emoji) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='960' height='540' viewBox='0 0 960 540'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='960' height='540' fill='url(#g)'/><text x='480' y='330' font-size='220' text-anchor='middle'>${emoji}</text></svg>`
  )}`

let seq = 0
const mk = (o) => {
  seq += 1
  const created = o.created_at ?? now() - hour(2 + seq)
  return {
    id: o.id || `m${seq}`,
    question: o.question,
    description: o.description ?? null,
    image_url: o.image_url ?? null,
    image_thumb_url: o.image_thumb_url ?? o.image_url ?? null,
    image_color: o.image_color ?? null,
    group_topic: o.group_topic ?? null,
    group_id: o.group_id ?? null,
    category: o.category || 'otros',
    created_at: iso(created),
    created_by: o.created_by || 'p1',
    resolved_at: o.resolved_at ? iso(o.resolved_at) : null,
    target_users: o.target_users || null,
    yes_pool: o.yes_pool ?? 1200,
    no_pool: o.no_pool ?? 1200,
    closed: !!o.closed,
    outcome: o.outcome || 'PENDING',
    closes_at: o.closes_at ? iso(o.closes_at) : null,
    static_rev: 0,
  }
}

const GROUP_PIZZA = 'g-pizza'
const GROUP_DOMINO = 'g-domino'
let markets = [
  mk({
    id: 'rain',
    question: '¿Lloverá el sábado en Margarita?',
    description: 'Cuenta como lluvia si cae agua por más de 10 minutos en la posada. Lo confirma Tomás.',
    category: 'clima',
    image_url: svg('#93c5fd', '#2563eb', '🌧️'),
    image_color: '#5a8de6',
    closes_at: now() + hour(3) + min(12),
    yes_pool: 1500,
    no_pool: 960,
  }),
  mk({
    id: 'sleep',
    question: '¿Papá se queda dormido en la playa antes de las 3 pm?',
    category: 'familia',
    closes_at: now() + min(24),
    yes_pool: 900,
    no_pool: 1700,
  }),
  mk({
    id: 'soon',
    question: '¿Mamá gana la partida de dominó de esta noche?',
    category: 'juegos',
    closes_at: now() + 38000,
    yes_pool: 1300,
    no_pool: 1100,
  }),
  mk({ id: 'pending', question: '¿Salimos antes de las 9 am hacia la isla?', category: 'viaje', closes_at: now() - min(10), yes_pool: 700, no_pool: 1900 }),
  mk({ id: 'noclose', question: '¿Alguien se cae al mar del bote?', category: 'juegos', yes_pool: 1100, no_pool: 1320 }),
  mk({
    id: 'done1',
    question: '¿Ganó Venezuela el amistoso del jueves?',
    category: 'deportes',
    image_url: svg('#6ee7b7', '#059669', '⚽'),
    closed: true,
    outcome: 'YES',
    resolved_at: now() - hour(6),
    created_at: now() - hour(30),
    yes_pool: 600,
    no_pool: 2300,
  }),
  mk({
    id: 'done2',
    question: '¿Se acabó la empanada antes del mediodía?',
    category: 'comida',
    closed: true,
    outcome: 'NO',
    resolved_at: now() - hour(20),
    created_at: now() - hour(40),
    yes_pool: 2100,
    no_pool: 700,
  }),
]
const pizzaOptions = [
  ['Papá', 1000, 1500],
  ['Mamá', 1700, 800],
  ['Tío Juan', 1300, 1140],
  ['Ana', 1900, 700],
]
pizzaOptions.forEach(([name, y, n], i) =>
  markets.push(
    mk({
      id: `pz${i}`,
      question: name,
      group_topic: '¿Quién comerá más pizza esta noche?',
      group_id: GROUP_PIZZA,
      category: 'comida',
      image_url: svg('#fdba74', '#ea580c', '🍕'),
      image_color: '#f08a3c',
      closes_at: now() + hour(5),
      yes_pool: y,
      no_pool: n,
      created_at: now() - hour(1),
    })
  )
)
;['Equipo Azul', 'Equipo Rojo'].forEach((name, i) =>
  markets.push(
    mk({
      id: `dm${i}`,
      question: name,
      group_topic: 'Torneo de dominó',
      group_id: GROUP_DOMINO,
      category: 'juegos',
      yes_pool: 1200 + i * 200,
      no_pool: 1200 - i * 200,
      created_at: now() - min(50),
    })
  )
)

// Rastro de precios por mercado: [{t, yes}]
const history = new Map()
const seedHistory = (m) => {
  const end = spotPrice(m, 'YES')
  const start = Date.parse(m.created_at)
  const pts = []
  const steps = 26
  let p = 0.5
  for (let i = 0; i <= steps; i += 1) {
    const t = start + ((now() - start) * i) / steps
    p = i === steps ? end : Math.min(0.95, Math.max(0.05, p + (end - p) * 0.22 + (Math.random() - 0.5) * 0.09))
    pts.push({ t, yes: p })
  }
  history.set(m.id, pts)
}
markets.forEach(seedHistory)

const shares = new Map() // `${user}|${market}|${side}` -> {count, cost}
const addShares = (user, market, side, count, cost) => {
  const k = `${user}|${market}|${side}`
  const cur = shares.get(k) || { count: 0, cost: 0 }
  shares.set(k, { count: cur.count + count, cost: cur.cost + cost })
}
addShares('me', 'rain', 'YES', 120, 61)
addShares('me', 'pz1', 'YES', 80, 38)
addShares('me', 'sleep', 'NO', 60, 33)
addShares('me', 'done1', 'YES', 150, 70)
addShares('me', 'done2', 'YES', 90, 52)

let txs = []
const pushTx = (o) => txs.unshift({ id: uid(), created_at: iso(o.at ?? now()), ...o })
;[
  ['p3', 'BUY', 'YES', 'rain', 50, 28],
  ['p1', 'BUY', 'NO', 'sleep', 25, 14],
  ['p5', 'BUY', 'YES', 'pz3', 80, 36],
  ['p2', 'SELL', 'YES', 'pz1', 15, 9],
  ['p7', 'BUY', 'YES', 'rain', 120, 70],
  ['me', 'BUY', 'YES', 'pz1', 38, 80],
].forEach(([user, type, side, market, cost, sh], i) =>
  pushTx({ user, type, side, market, total_cost: cost, shares_amount: sh, price_per_share: cost / sh, at: now() - min(3 + i * 7) })
)
markets.find((m) => m.id === 'rain').trades_extra = 8

let notifications = []
let suggestions = [
  { id: 's1', user_id: 'p4', question: '¿Se acaba el hielo antes de las 4 pm?', description: null, category: 'comida', options: null, status: 'pending', created_at: iso(now() - min(35)) },
  {
    id: 's2',
    user_id: 'p6',
    question: '¿Quién se quema más con el sol?',
    description: 'Cuenta quien termine más rojo al final del día.',
    category: 'viaje',
    options: ['Papá', 'Tío Juan', 'Ricky'],
    status: 'pending',
    created_at: iso(now() - hour(2)),
  },
  { id: 's3', user_id: 'me', question: '¿Cantamos en el carro de regreso?', description: null, category: 'musica', options: null, status: 'rejected', reject_reason: 'Ya existe uno parecido', created_at: iso(now() - hour(9)) },
]
let adminLog = [
  { id: 3, created_at: iso(now() - min(20)), action: 'create_market', admin_username: 'MariChris', target_username: null, amount: null, detail: { question: '¿Quién comerá más pizza esta noche?' } },
  { id: 2, created_at: iso(now() - hour(6)), action: 'resolve_market', admin_username: 'Cheche', target_username: null, amount: 150, detail: { question: '¿Ganó Venezuela el amistoso del jueves?' } },
  { id: 1, created_at: iso(now() - hour(30)), action: 'moderator_on', admin_username: 'Cheche', target_username: 'Tomas_christiansen', amount: null, detail: {} },
]
let moves = 3
let tourDone = !(typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tour'))
let revCounter = 1

// ------------------------------------------------------------------ helpers
const stateOf = (m) => (m.closed ? 'resolved' : m.closes_at && now() >= Date.parse(m.closes_at) ? 'pending' : 'open')
const visible = (m) => me.is_admin || !m.target_users?.includes('me') || m.created_by === 'me'
const tradesOf = (m, ms) => txs.filter((t) => t.market === m.id && ['BUY', 'SELL'].includes(t.type) && now() - Date.parse(t.created_at) < ms)
const posValue = (userId) => {
  let v = 0
  for (const [k, s] of shares) {
    const [u, mid, side] = k.split('|')
    if (u !== userId || s.count <= 0) continue
    const m = markets.find((x) => x.id === mid)
    if (m && !m.closed) v += s.count * spotPrice(m, side)
  }
  return v
}
const netWorth = (p) => p.balance + posValue(p.id)
const lookup = (id) => byId(id)?.username || 'Alguien'

const priceRow = (m) => {
  const t24 = tradesOf(m, hour(24)).length + (m.trades_extra || 0)
  const t3 = tradesOf(m, hour(3)).length + (m.trades_extra || 0)
  const hist = history.get(m.id) || []
  const old = hist.find((h) => h.t >= now() - hour(24)) || hist[0]
  return {
    id: m.id,
    yes_pool: String(m.yes_pool),
    no_pool: String(m.no_pool),
    closed: m.closed,
    outcome: m.outcome,
    closes_at: m.closes_at,
    static_rev: m.static_rev,
    trades_24h: t24,
    traders_24h: Math.min(t24, 4),
    trades_total: t24 + 3,
    score: t3 * 4 + t24 + Math.min(t24, 4) * 2 + (now() - Date.parse(m.created_at) < hour(6) ? 3 : 0),
    yes_price_24h: m.closed ? null : old ? old.yes : 0.5,
  }
}

const staticRow = (m) => {
  const { yes_pool, no_pool, closed, outcome, closes_at, trades_extra, ...rest } = m // eslint-disable-line no-unused-vars
  return rest
}

const activity = ({ limit = 20, marketId = null, groupId = null }) => {
  const ev = []
  for (const t of txs) {
    const m = markets.find((x) => x.id === t.market)
    if (!m || !visible(m)) continue
    if (marketId && m.id !== marketId) continue
    if (groupId && m.group_id !== groupId) continue
    if (!['BUY', 'SELL'].includes(t.type)) continue
    ev.push({ kind: t.type, at: t.created_at, username: lookup(t.user), market_id: m.id, question: m.question, group_topic: m.group_topic, side: t.side, amount: t.total_cost, outcome: null })
  }
  for (const m of markets) {
    if (!visible(m) || (marketId && m.id !== marketId) || (groupId && m.group_id !== groupId)) continue
    ev.push({ kind: 'MARKET_NEW', at: m.created_at, username: lookup(m.created_by), market_id: m.id, question: m.question, group_topic: m.group_topic, side: null, amount: null, outcome: null })
    if (m.closed && m.resolved_at) ev.push({ kind: 'MARKET_RESOLVED', at: m.resolved_at, username: null, market_id: m.id, question: m.question, group_topic: m.group_topic, side: null, amount: null, outcome: m.outcome })
  }
  return ev.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit)
}

const bump = (m) => {
  revCounter += 1
  m.static_rev = revCounter
}

// ------------------------------------------------------------------ RPC
const handlers = {
  async get_market_prices() {
    return markets.filter(visible).map(priceRow)
  },

  async get_session_state() {
    const n = notifications.filter((x) => !x.seen)
    return {
      server_now: iso(now()),
      daily: { used: moves, remaining: 60 - moves, limit: 60, resets_at: iso(now() + hour(9)) },
      notifications: n,
      pending_suggestions: me.is_admin || me.is_moderator ? suggestions.filter((s) => s.status === 'pending').length : null,
    }
  },

  async mark_notifications_seen({ p_ids }) {
    notifications.forEach((n) => p_ids.includes(n.id) && (n.seen = true))
    return null
  },

  async get_recent_activity({ p_limit, p_market_id, p_group_id }) {
    return activity({ limit: p_limit, marketId: p_market_id, groupId: p_group_id })
  },

  async get_market_history({ p_market_id, p_limit = 120, p_since }) {
    const since = p_since ? Date.parse(p_since) : 0
    const pts = (history.get(p_market_id) || []).filter((h) => h.t >= since)
    const out = pts.length > p_limit ? pts.filter((_, i) => i % Math.ceil(pts.length / p_limit) === 0) : pts
    return out.map((h) => ({ created_at: iso(h.t), yes_price: h.yes, no_price: 1 - h.yes }))
  },

  async get_group_history({ p_group_id, p_since }) {
    const since = p_since ? Date.parse(p_since) : 0
    const rows = []
    for (const m of markets.filter((x) => x.group_id === p_group_id)) {
      for (const h of history.get(m.id) || []) if (h.t >= since) rows.push({ market_id: m.id, created_at: iso(h.t), yes_price: h.yes })
    }
    return rows
  },

  async buy_shares({ p_market_id, p_side, p_investment, p_max_price }) {
    const m = markets.find((x) => x.id === p_market_id)
    if (!m || !visible(m)) throw new Error('El mercado no existe')
    if (stateOf(m) !== 'open') throw new Error('Las apuestas de este mercado ya cerraron.')
    const q = quoteBuy(m, p_side, p_investment, DEFAULT_CONFIG)
    if (q.error) throw new Error(q.error)
    if (window.__mock?.failNext) {
      window.__mock.failNext = false
      throw new Error('El precio cambió: pagarías 61.00¢ por acción y tu máximo es 55.00¢. Aumenta la tolerancia o reintenta.')
    }
    if (p_max_price != null && q.avgPrice > p_max_price) throw new Error(`El precio cambió: pagarías ${(q.avgPrice * 100).toFixed(2)}¢ por acción y tu máximo es ${(p_max_price * 100).toFixed(2)}¢.`)
    if (me.balance < q.investment) throw new Error(`Saldo insuficiente. Tienes $${me.balance.toFixed(2)}`)
    me.balance = Math.round((me.balance - q.investment) * 1e4) / 1e4
    m.yes_pool = q.newYesPool
    m.no_pool = q.newNoPool
    addShares('me', m.id, p_side, q.shares, q.investment)
    pushTx({ user: 'me', type: 'BUY', side: p_side, market: m.id, total_cost: q.investment, shares_amount: q.shares, price_per_share: q.avgPrice })
    history.get(m.id).push({ t: now(), yes: spotPrice(m, 'YES') })
    moves += 1
    return {
      success: true,
      shares_bought: q.shares,
      price: q.avgPrice,
      final_price: q.finalPrice,
      investment: q.investment,
      fee_paid: q.fee,
      daily_moves_remaining: 60 - moves,
      new_balance: me.balance,
      yes_pool: m.yes_pool,
      no_pool: m.no_pool,
    }
  },

  async sell_shares({ p_market_id, p_side, p_shares_to_sell }) {
    const m = markets.find((x) => x.id === p_market_id)
    if (!m || stateOf(m) !== 'open') throw new Error('Las apuestas de este mercado ya cerraron.')
    const k = `me|${m.id}|${p_side}`
    const own = shares.get(k)
    if (!own || own.count < p_shares_to_sell) throw new Error('No tienes suficientes acciones')
    const q = quoteSell(m, p_side, p_shares_to_sell, DEFAULT_CONFIG)
    if (q.error) throw new Error(q.error)
    me.balance = Math.round((me.balance + q.payout) * 1e4) / 1e4
    m.yes_pool = q.newYesPool
    m.no_pool = q.newNoPool
    const ratio = p_shares_to_sell / own.count
    shares.set(k, { count: own.count - p_shares_to_sell, cost: own.cost * (1 - ratio) })
    pushTx({ user: 'me', type: 'SELL', side: p_side, market: m.id, total_cost: q.payout, shares_amount: p_shares_to_sell, price_per_share: q.avgPrice })
    history.get(m.id).push({ t: now(), yes: spotPrice(m, 'YES') })
    moves += 1
    return { success: true, shares_sold: p_shares_to_sell, payout: q.payout, fee_paid: q.fee, price: q.avgPrice, final_price: q.finalPrice, daily_moves_remaining: 60 - moves, new_balance: me.balance, yes_pool: m.yes_pool, no_pool: m.no_pool }
  },

  async get_my_portfolio() {
    const positions = []
    for (const [k, s] of shares) {
      const [u, mid, side] = k.split('|')
      if (u !== 'me' || s.count <= 0.000001) continue
      const m = markets.find((x) => x.id === mid)
      if (!m) continue
      positions.push({ market_id: mid, question: m.question, group_topic: m.group_topic, side, shares: s.count, outcome: m.outcome, closed: m.closed, yes_pool: m.yes_pool, no_pool: m.no_pool, avg_cost: s.cost / s.count })
    }
    return { balance: me.balance, positions }
  },

  async get_leaderboard() {
    const rows = players
      .map((p) => ({ user_id: p.id, username: p.username, cash: p.balance, positions_value: posValue(p.id), net_worth: netWorth(p) }))
      .sort((a, b) => b.net_worth - a.net_worth)
    return rows.map((r, i) => ({ ...r, rank: i + 1 }))
  },

  async get_networth_race({ p_since }) {
    const since = p_since ? Date.parse(p_since) : 0
    const rows = []
    const steps = 30
    players.forEach((p, pi) => {
      let v = 1000
      const end = netWorth(p)
      for (let i = 0; i <= steps; i += 1) {
        const t = now() - hour(8) + (hour(8) * i) / steps
        v = i === steps ? end : v + (end - v) * 0.12 + (Math.sin(i * 0.9 + pi) * 18 + (Math.random() - 0.5) * 14)
        if (t >= since) rows.push({ user_id: p.id, username: p.username, taken_at: iso(t), net_worth: v })
      }
    })
    return rows
  },

  async get_player_profile({ p_user_id }) {
    const p = byId(p_user_id)
    const lb = (await handlers.get_leaderboard()).find((r) => r.user_id === p_user_id)
    return {
      user_id: p.id,
      username: p.username,
      member_since: p.created_at,
      rank: lb.rank,
      players: players.length,
      net_worth: lb.net_worth,
      cash: lb.cash,
      positions_value: lb.positions_value,
      trades: 14 + p.username.length,
      markets_traded: 5,
      open_markets: 2,
      favorite_category: 'comida',
      wins: 4,
      losses: 3,
      win_rate: 0.5714,
      realized_pl: 83.4,
      current_streak: 2,
      current_streak_kind: 'W',
      best_win_streak: 3,
      best_win: { amount: 96.2, question: '¿Ganó Venezuela el amistoso del jueves?' },
      worst_loss: { amount: -41.5, question: '¿Se acabó la empanada antes del mediodía?' },
    }
  },

  async suggest_market({ p_question, p_description, p_category, p_options }) {
    if (p_question.trim().length < 8) throw new Error('La pregunta debe tener entre 8 y 200 caracteres')
    if (suggestions.filter((s) => s.user_id === 'me' && s.status === 'pending').length >= 3) throw new Error('Ya tienes 3 sugerencias pendientes. Espera a que las revisen.')
    suggestions.unshift({ id: uid(), user_id: 'me', question: p_question, description: p_description, category: p_category, options: p_options, status: 'pending', created_at: iso(now()) })
    return { success: true }
  },
  async get_my_suggestions() {
    return suggestions.filter((s) => s.user_id === 'me')
  },
  async staff_list_suggestions({ p_status }) {
    return suggestions
      .filter((s) => !p_status || s.status === p_status)
      .map((s) => ({ ...s, username: lookup(s.user_id), reviewed_by_username: s.status === 'pending' ? null : 'Cheche', market_id: null }))
  },
  async staff_review_suggestion(a) {
    const s = suggestions.find((x) => x.id === a.p_id)
    if (!s || s.status !== 'pending') throw new Error('Esta sugerencia ya fue revisada')
    if (a.p_action === 'reject') {
      s.status = 'rejected'
      s.reject_reason = a.p_reason
      return { success: true, status: 'rejected' }
    }
    s.status = 'approved'
    if (s.options?.length) {
      const gid = uid()
      s.options.forEach((o) => markets.push(newMarket({ question: o, group_topic: a.p_question || s.question, group_id: gid, ...fromArgs(a) })))
    } else markets.push(newMarket({ question: a.p_question || s.question, ...fromArgs(a) }))
    return { success: true, status: 'approved' }
  },

  async staff_create_market(a) {
    if (a.p_closes_at && Date.parse(a.p_closes_at) <= now() + 30000) throw new Error('La fecha de cierre debe estar en el futuro')
    const m = newMarket({ question: a.p_question, ...fromArgs(a) })
    markets.push(m)
    return m.id
  },
  async staff_create_market_group(a) {
    const gid = uid()
    a.p_options.filter(Boolean).forEach((o) => markets.push(newMarket({ question: o, group_topic: a.p_topic, group_id: gid, ...fromArgs(a) })))
    return { created: a.p_options.length, group_id: gid }
  },
  async staff_update_market({ p_market_id, p_patch, p_apply_group }) {
    const m = markets.find((x) => x.id === p_market_id)
    const targets = p_apply_group && m.group_id ? markets.filter((x) => x.group_id === m.group_id) : [m]
    for (const t of targets) {
      Object.entries(p_patch).forEach(([k, v]) => {
        if (k === 'question' && t !== m) return
        if (k === 'description' && t !== m && !p_apply_group) return
        t[k] = v
      })
      bump(t)
    }
    return { success: true, updated: targets.length }
  },
  async staff_list_players() {
    return players.map(({ id, username, is_moderator, is_admin }) => ({ id, username, is_moderator, is_admin }))
  },
  async admin_list_players() {
    return players.map((p) => ({ ...p }))
  },
  async admin_list_invites() {
    return [
      ...players.map((p, i) => ({ email: `${p.username.toLowerCase()}@gmail.com`, password_ok: i % 3 === 0, note: null, created_at: iso(now() - hour(24 * 30)), username: p.username, joined: true })),
      ...invites,
    ]
  },
  async admin_invite_emails({ p_emails, p_password_ok }) {
    let added = 0
    let already = 0
    const invalid = []
    for (const raw of p_emails) {
      const email = String(raw || '').trim().toLowerCase()
      if (!email) continue
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) invalid.push(email)
      else if (invites.some((x) => x.email === email)) already += 1
      else {
        invites.unshift({ email, password_ok: !!p_password_ok, note: null, created_at: iso(now()), username: null, joined: false })
        added += 1
      }
    }
    return { added, already, invalid }
  },
  async admin_set_invite_password({ p_email, p_value }) {
    const x = invites.find((i) => i.email === p_email)
    if (x) x.password_ok = p_value
    return { success: true }
  },
  async admin_remove_invite({ p_email }) {
    const i = invites.findIndex((x) => x.email === p_email)
    if (i >= 0) invites.splice(i, 1)
    return { success: true }
  },
  async admin_set_moderator({ p_user_id, p_value }) {
    byId(p_user_id).is_moderator = p_value
    return { success: true }
  },
  async admin_rename_player({ p_user_id, p_username }) {
    byId(p_user_id).username = p_username
    return { success: true, username: p_username }
  },
  async admin_reset_password() {
    return { success: true }
  },
  async admin_update_balance({ p_user_id, p_amount }) {
    byId(p_user_id).balance += p_amount
    return { success: true }
  },
  async admin_recent_actions() {
    return adminLog
  },
  async resolve_market({ p_market_id, p_outcome }) {
    const m = markets.find((x) => x.id === p_market_id)
    m.closed = true
    m.outcome = p_outcome
    m.resolved_at = iso(now())
    bump(m)
    const mine = shares.get(`me|${m.id}|${p_outcome}`)
    const other = shares.get(`me|${m.id}|${p_outcome === 'YES' ? 'NO' : 'YES'}`)
    if (mine || other) {
      const invested = (mine?.cost || 0) + (other?.cost || 0)
      const payout = mine?.count || 0
      me.balance += payout
      notifications.push({ id: uid(), kind: payout > 0 ? 'MARKET_WON' : 'MARKET_LOST', market_id: m.id, created_at: iso(now()), payload: { question: m.question, group_topic: m.group_topic, outcome: p_outcome, payout, invested, profit: payout - invested } })
    }
    return { success: true, outcome: p_outcome, total_paid: 100, winners: 1 }
  },
  async admin_reopen_market({ p_market_id }) {
    const m = markets.find((x) => x.id === p_market_id)
    m.closed = false
    m.outcome = 'PENDING'
    m.resolved_at = null
    bump(m)
    return { success: true, users: 1, reversed: 100, clamped_users: 0 }
  },
  async delete_market_and_refund({ p_market_id }) {
    markets = markets.filter((x) => x.id !== p_market_id)
    return { success: true, users: 1, net_refunded: 50, clamped_users: 0 }
  },
  async admin_archive_and_reset() {
    return { success: true, players: players.length, markets: markets.length }
  },
  async complete_tour() {
    tourDone = true
    return { success: true }
  },
  async set_username({ p_username }) {
    me.username = p_username
    return { success: true }
  },

  async list_seasons() {
    return [{ id: 's1', slug: 'viaje-2025', title: 'FamilyMarket · Viaje a Margarita', played_from: iso(now() - hour(24 * 300)), played_to: iso(now() - hour(24 * 296)), players: 9, markets: 14, champion: 'Tomas_christiansen', champion_net_worth: 1431.2 }]
  },
}

function fromArgs(a) {
  return {
    description: a.p_description,
    category: a.p_category || 'otros',
    closes_at: a.p_closes_at ? Date.parse(a.p_closes_at) : null,
    image_url: a.p_image_url,
    image_thumb_url: a.p_image_thumb_url,
    image_color: a.p_image_color,
    target_users: a.p_target_users,
    created_by: 'me',
    created_at: now(),
  }
}
function newMarket(o) {
  const m = mk(o)
  seedHistory(m)
  return m
}

// ------------------------------------------------------------------ API pública del mock
export async function rpc(name, args = {}) {
  await delay()
  const fn = handlers[name]
  if (!fn) throw new Error(`[mock] RPC sin implementar: ${name}`)
  return structuredClone(await fn(args))
}

export const db = {
  async gameSettings() {
    await delay(40)
    return { ...DEFAULT_CONFIG }
  },
  async marketsByIds(ids) {
    await delay()
    return markets.filter((m) => ids.includes(m.id) && visible(m)).map((m) => structuredClone(staticRow(m)))
  },
  async myShares(marketId) {
    await delay(60)
    return ['YES', 'NO'].map((side) => ({ side, count: shares.get(`me|${marketId}|${side}`)?.count || 0 })).filter((r) => r.count > 0)
  },
  async myOperations() {
    await delay(60)
    return txs
      .filter((t) => t.user === 'me')
      .map((t) => {
        const m = markets.find((x) => x.id === t.market)
        return { ...t, market_id: t.market, markets: { question: m?.question, group_topic: m?.group_topic } }
      })
  },
  async profile() {
    await delay(40)
    return { data: { id: me.id, username: me.username, balance: me.balance, is_admin: me.is_admin, is_moderator: me.is_moderator, email: 'cheche@familia.test', tour_completed_at: tourDone ? iso(now() - hour(5)) : null }, error: null }
  },
  async uploadImage(path, blob) {
    await delay(200)
    return URL.createObjectURL(blob)
  },
}

let session =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('signedout') ? null : { user: { id: 'me', email: 'cheche@familia.test' } }
const listeners = new Set()
export const auth = {
  async getSession() {
    await delay(30)
    return { data: { session } }
  },
  onChange(cb) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  async signIn() {
    session = { user: { id: 'me', email: 'cheche@familia.test' } }
    listeners.forEach((cb) => cb('SIGNED_IN', session))
    return { data: { session }, error: null }
  },
  async signUp() {
    return auth.signIn()
  },
  async signInWithGoogle() {
    return auth.signIn()
  },
  async signOut() {
    session = null
    listeners.forEach((cb) => cb('SIGNED_OUT', null))
    return { error: null }
  },
}

// Controles para pruebas manuales desde la consola del navegador.
const notify = (kind, payload, market_id = null) =>
  notifications.push({ id: uid(), kind, market_id, created_at: iso(now()), payload })
window.__mock = {
  role: ROLE,
  failNext: false,
  win: (profit = 42.5) => notify('MARKET_WON', { question: '¿Lloverá el sábado en Margarita?', outcome: 'YES', payout: 120, invested: 120 - profit, profit }, 'rain'),
  lose: () => notify('MARKET_LOST', { question: '¿Papá se queda dormido en la playa?', outcome: 'YES', payout: 0, invested: 33, profit: -33 }, 'sleep'),
  groupWin: () => notify('MARKET_WON', { question: 'Mamá', group_topic: '¿Quién comerá más pizza esta noche?', outcome: 'YES', payout: 80, invested: 38, profit: 42 }, 'pz1'),
  reopened: () => notify('MARKET_REOPENED', { question: '¿Ganó Venezuela el amistoso?', reversed: 150 }),
  cancelled: () => notify('MARKET_CANCELLED', { question: '¿Se acabó el hielo?', refunded: 25 }),
  approved: () => notify('SUGGESTION_APPROVED', { question: '¿Cantamos en el carro?' }, 'rain'),
  rejected: () => notify('SUGGESTION_REJECTED', { question: '¿Cantamos en el carro?', reason: 'Ya existe uno parecido' }),
  resolve: (id, outcome = 'YES') => handlers.resolve_market({ p_market_id: id, p_outcome: outcome }),
  trade: (id, side = 'YES', amount = 20) => {
    const m = markets.find((x) => x.id === id)
    const q = quoteBuy(m, side, amount, DEFAULT_CONFIG)
    m.yes_pool = q.newYesPool
    m.no_pool = q.newNoPool
    history.get(id).push({ t: now(), yes: spotPrice(m, 'YES') })
    pushTx({ user: 'p3', type: 'BUY', side, market: id, total_cost: amount, shares_amount: q.shares, price_per_share: q.avgPrice })
  },
  state: () => ({ markets, shares: [...shares], notifications }),
}
