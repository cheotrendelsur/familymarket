// =====================================================================
// Simulación realista de N jugadores simultáneos (comportamiento de la app real)
//   LOADTEST_ENV=/ruta/testenv.json SIM_PLAYERS=40 SIM_SECONDS=150 node scripts/simulate.mjs
// - cada jugador sondea mercados (12 s), ranking (30 s), movimientos (60 s) como la app
// - opera cada ~35 s (compra/venta con tolerancia 3 % sobre su cotización local)
// - a mitad de partida: "estampida" (se abre un mercado y los N compran en 3 s)
// - el admin resuelve un mercado mientras siguen operando
// Mide latencias, bytes descargados, errores y verifica invariantes al final.
// =====================================================================
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CONFIG, newRequestId, quoteBuy, quoteSell, spotPrice } from '../src/lib/trading.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_FILE = process.env.LOADTEST_ENV
const cfg = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'))
const N = Number(process.env.SIM_PLAYERS || 40)
const DURATION = Number(process.env.SIM_SECONDS || 150)
const MAX_INFLIGHT = Number(process.env.SIM_INFLIGHT || 28)

const dot = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const URL_ = dot.VITE_SUPABASE_URL
const KEY = dot.VITE_SUPABASE_ANON_KEY

// ---------- instrumentación ----------
const kinds = {}
const rec = (kind) => (kinds[kind] ||= { n: 0, ms: [], decoded: 0, wire: 0, wireN: 0, enc: {}, errors: {} })
const classify = (url) => {
  const u = String(url)
  const m = u.match(/\/rest\/v1\/(rpc\/)?([a-z_]+)/)
  if (!m) return u.includes('/auth/') ? 'auth' : 'other'
  const name = m[2]
  if (name === 'markets') return 'GET markets (sondeo)'
  if (name === 'shares') return 'GET shares (propias)'
  if (name === 'transactions') return 'GET transactions'
  return `rpc ${name}`
}
let inflight = 0
const waiters = []
async function slot() {
  if (inflight >= MAX_INFLIGHT) await new Promise((r) => waiters.push(r))
  inflight += 1
}
const free = () => {
  inflight -= 1
  waiters.shift()?.()
}
async function instrumentedFetch(input, init = {}) {
  const kind = classify(typeof input === 'string' ? input : input.url)
  const headers = new Headers(init.headers || {})
  headers.set('Accept-Encoding', 'gzip, deflate, br')
  await slot()
  const t = performance.now()
  try {
    const res = await fetch(input, { ...init, headers })
    const buf = await res.clone().arrayBuffer()
    const r = rec(kind)
    r.n += 1
    r.ms.push(performance.now() - t)
    r.decoded += buf.byteLength
    const enc = res.headers.get('content-encoding') || 'identity'
    r.enc[enc] = (r.enc[enc] || 0) + 1
    const cl = Number(res.headers.get('content-length'))
    if (cl) {
      r.wire += cl
      r.wireN += 1
    }
    return res
  } catch (e) {
    const r = rec(kind)
    r.errors['red: ' + (e.cause?.code || e.message).slice(0, 40)] = (r.errors['red: ' + (e.cause?.code || e.message).slice(0, 40)] || 0) + 1
    throw e
  } finally {
    free()
  }
}
const mk = (token) =>
  createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {}, fetch: instrumentedFetch },
  })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jitter = (ms) => ms * (0.75 + Math.random() * 0.5)
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0)
const MARKET_COLS = 'id, question, description, image_url, yes_pool, no_pool, outcome, closed, created_at, resolved_at, group_topic, target_users'

// ---------- login ----------
console.log(`Iniciando sesión de ${N + 1} cuentas…`)
const raw = []
let loginLimited = 0
for (let i = 0; i <= N; i += 1) {
  const c = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  let result
  for (let attempt = 0; attempt < 12; attempt += 1) {
    result = await c.auth.signInWithPassword({ email: `${cfg.prefix}${String(i).padStart(2, '0')}@${cfg.domain}`, password: cfg.password })
    if (!result.error || !/rate limit/i.test(result.error.message)) break
    loginLimited += 1
    await sleep(2500) // los usuarios reales reintentan unos segundos después
  }
  if (result.error) throw new Error(`login ${i}: ${result.error.message}`)
  raw.push({ i, id: result.data.user.id, token: result.data.session.access_token })
  await sleep(700) // llegadas escalonadas
}
if (loginLimited) console.log(`(Auth limitó ${loginLimited} inicios de sesión seguidos desde esta IP; se reintentaron solos)`)
for (const k of Object.keys(kinds)) delete kinds[k] // no contar el login
const admin = mk(raw[0].token)

// ---------- mercados iniciales ----------
const created = []
for (let k = 0; k < 6; k += 1) created.push((await admin.rpc('staff_create_market', { p_question: `[TEST] Mercado ${k + 1}: ¿ocurrirá el evento ${k + 1}?`, p_description: 'Mercado de simulación con una descripción de ejemplo para medir el peso real.' })).data)
for (const g of ['A', 'B']) {
  const r = await admin.rpc('staff_create_market_group', { p_topic: `[TEST] ¿Quién gana el grupo ${g}?`, p_options: [`[TEST] Papá ${g}`, `[TEST] Mamá ${g}`, `[TEST] Tío ${g}`] })
  created.push(...(r.data?.ids || []))
}
console.log(`Mercados creados: ${created.length}. Simulando ${N} jugadores durante ${DURATION}s…\n`)

// ---------- jugadores ----------
const outcomes = { buyOk: 0, sellOk: 0, slippage: 0, limit: 0, other: {} }
const stop = { v: false }
const players = raw.slice(1, N + 1).map((p) => ({ ...p, c: mk(p.token), markets: [], held: {} }))

// Igual que la app: sondeo LIGERO de precios; los textos/fotos se bajan solo cuando aparece un mercado nuevo.
async function pollMarkets(pl) {
  const { data } = await pl.c.rpc('get_market_prices')
  if (!data) return
  const known = new Set((pl.statics || []).map((m) => m.id))
  if (data.some((r) => !known.has(r.id))) {
    const { data: st } = await pl.c.from('markets').select(MARKET_COLS)
    if (st) pl.statics = st
  }
  pl.markets = data
}
async function trade(pl, force) {
  const active = pl.markets.filter((m) => !m.closed)
  if (!active.length) return
  const m = force || active[Math.floor(Math.random() * active.length)]
  const side = Math.random() < 0.5 ? 'YES' : 'NO'
  await pl.c.from('shares').select('side, count').eq('market_id', m.id) // loadOwned del panel
  const key = `${m.id}:${side}`
  const owned = pl.held[key] || 0
  if (owned > 1 && Math.random() < 0.3) {
    const q = quoteSell(m, side, owned * (0.3 + Math.random() * 0.7), DEFAULT_CONFIG)
    if (q.error) return
    const { data, error } = await pl.c.rpc('sell_shares', { p_market_id: m.id, p_side: side, p_shares_to_sell: q.shares, p_min_price: q.avgPrice * 0.97, p_request_id: newRequestId() })
    if (error) return tally(error)
    outcomes.sellOk += 1
    pl.held[key] = Math.max(0, owned - q.shares)
    return data
  }
  const amount = Math.round((5 + Math.random() * 35) * 100) / 100
  const q = quoteBuy(m, side, amount, DEFAULT_CONFIG)
  if (q.error) return
  const { data, error } = await pl.c.rpc('buy_shares', { p_market_id: m.id, p_side: side, p_investment: q.investment, p_max_price: Math.min(q.avgPrice * 1.05, 1), p_request_id: newRequestId() })
  if (error) return tally(error)
  outcomes.buyOk += 1
  pl.held[key] = owned + data.shares_bought
  const idx = pl.markets.findIndex((x) => x.id === m.id)
  if (idx >= 0) pl.markets[idx] = { ...pl.markets[idx], yes_pool: String(data.yes_pool), no_pool: String(data.no_pool) }
  return data
}
function tally(error) {
  const msg = error.message || ''
  if (/precio cambi/i.test(msg)) outcomes.slippage += 1
  else if (/Límite de/.test(msg)) outcomes.limit += 1
  else outcomes.other[msg.slice(0, 50)] = (outcomes.other[msg.slice(0, 50)] || 0) + 1
}

async function runPlayer(pl) {
  await sleep(Math.random() * 12000) // llegadas escalonadas
  await pollMarkets(pl)
  const timers = []
  const every = (ms, fn) => {
    const loop = async () => {
      while (!stop.v) {
        await sleep(jitter(ms))
        if (stop.v) break
        try { await fn() } catch { /* se contabiliza en el instrumentado */ }
      }
    }
    timers.push(loop())
  }
  every(12000, () => pollMarkets(pl))
  every(30000, () => (Math.random() < 0.5 ? pl.c.rpc('get_leaderboard') : null)) // solo si está en Home
  every(15000, () => pl.c.rpc('get_session_state'))
  every(20000, () => (Math.random() < 0.5 ? pl.c.rpc('get_recent_activity', { p_limit: 30 }) : null)) // cinta «En vivo» de Inicio
  every(25000, () => (Math.random() < 0.3 && pl.markets[0] ? pl.c.rpc('get_market_history', { p_market_id: pl.markets[0].id, p_limit: 150 }) : null)) // pantalla Trade
  every(45000, () => (Math.random() < 0.2 ? pl.c.rpc('get_my_portfolio') : null)) // pantalla Portafolio
  every(35000, () => trade(pl)) // opera cada ~35 s
  await Promise.all(timers)
}

const t0 = performance.now()
const running = players.map(runPlayer)

// ---------- escenas especiales ----------
await sleep(DURATION * 0.45 * 1000)
console.log('⚡ ESTAMPIDA: el admin abre un mercado nuevo y todos compran en ~3 s…')
const hot = (await admin.rpc('staff_create_market', { p_question: '[TEST] ¡Mercado caliente! ¿Gana el equipo local?' })).data
created.push(hot)
const stampede = performance.now()
const stamp = { ok: 0, slippage: 0, fail: 0, ms: [] }
await Promise.all(
  players.map(async (pl) => {
    await sleep(Math.random() * 3000)
    await pollMarkets(pl) // la tarjeta aparece tras un sondeo
    const m = pl.markets.find((x) => x.id === hot)
    if (!m) return void (stamp.fail += 1)
    const side = Math.random() < 0.6 ? 'YES' : 'NO'
    const q = quoteBuy(m, side, 20, DEFAULT_CONFIG)
    const t = performance.now()
    const { error } = await pl.c.rpc('buy_shares', { p_market_id: hot, p_side: side, p_investment: 20, p_max_price: Math.min(q.avgPrice * 1.05, 1), p_request_id: newRequestId() })
    stamp.ms.push(performance.now() - t)
    if (!error) stamp.ok += 1
    else if (/precio cambi/i.test(error.message)) stamp.slippage += 1
    else stamp.fail += 1
  })
)
console.log(`   estampida terminada en ${((performance.now() - stampede) / 1000).toFixed(1)}s: ${stamp.ok} compras OK · ${stamp.slippage} rechazadas por cambio de precio (tolerancia 3 %) · ${stamp.fail} otros fallos · latencia de la compra p50=${pct(stamp.ms, 50).toFixed(0)}ms p95=${pct(stamp.ms, 95).toFixed(0)}ms\n`)

await sleep(Math.max(0, DURATION * 0.30 * 1000))
const victim = created[1]
const res = await admin.rpc('resolve_market', { p_market_id: victim, p_outcome: 'YES' })
console.log(`🏁 El admin resolvió un mercado con jugadores operando: ${res.error ? 'ERROR ' + res.error.message : `pagó $${res.data.total_paid.toFixed(2)} a ${res.data.winners} jugadores`}`)

await sleep(Math.max(0, DURATION * 1000 - (performance.now() - t0)))
stop.v = true
await Promise.race([Promise.all(running), sleep(15000)])
const wall = (performance.now() - t0) / 1000

// ---------- informe ----------
console.log(`\n══════ RESULTADOS (${N} jugadores, ${wall.toFixed(0)} s) ══════`)
console.log('Peticiones por tipo:'.padEnd(34), 'n'.padStart(5), 'p50'.padStart(7), 'p95'.padStart(7), 'p99'.padStart(7), '  bytes/resp'.padStart(12), '  errores')
let totalDecoded = 0
let totalReq = 0
for (const [k, r] of Object.entries(kinds).sort((a, b) => b[1].decoded - a[1].decoded)) {
  totalDecoded += r.decoded
  totalReq += r.n
  const errs = Object.entries(r.errors).map(([e, c]) => `${e}×${c}`).join(' ')
  console.log(k.padEnd(34), String(r.n).padStart(5), `${pct(r.ms, 50).toFixed(0)}ms`.padStart(7), `${pct(r.ms, 95).toFixed(0)}ms`.padStart(7), `${pct(r.ms, 99).toFixed(0)}ms`.padStart(7), String(Math.round(r.decoded / Math.max(r.n, 1))).padStart(12), '  ' + errs, `[${Object.entries(r.enc).map(([e, c]) => `${e}:${c}`).join(',')}${r.wireN ? ` · en la red ${Math.round(r.wire / r.wireN)}B` : ''}]`)
}
console.log(`\nTotal: ${totalReq} peticiones (${(totalReq / wall).toFixed(1)}/s en todo el servidor) · ${(totalDecoded / 1024).toFixed(0)} KB descargados sin comprimir`)
console.log(`Por jugador: ${(totalDecoded / N / wall * 3600 / 1024 / 1024).toFixed(2)} MB/hora sin comprimir → 40 jugadores × 8 h × 5 días ≈ ${((totalDecoded / N / wall) * 3600 * 8 * 5 * 40 / 1024 / 1024 / 1024).toFixed(2)} GB (sin comprimir; con compresión será menos)`)
console.log(`Operaciones: ${outcomes.buyOk} compras OK, ${outcomes.sellOk} ventas OK, ${outcomes.slippage} rechazadas por cambio de precio, ${outcomes.limit} por límite diario, otros: ${JSON.stringify(outcomes.other)}`)

// ---------- invariantes ----------
console.log('\nInvariantes (todos los mercados de prueba):')
const L0 = Number((await admin.from('game_settings').select('initial_liquidity').single()).data.initial_liquidity)
let bad = 0
for (const id of created) {
  const { data: m } = await admin.from('markets').select('yes_pool,no_pool,closed').eq('id', id).single()
  let sy = 0
  let sn = 0
  for (const pl of players) {
    const { data } = await pl.c.from('shares').select('side,count').eq('market_id', id)
    ;(data || []).forEach((r) => (r.side === 'YES' ? (sy += Number(r.count)) : (sn += Number(r.count))))
  }
  // Las piscinas iniciales salen del primer punto del historial (en mercados de varias opciones no son 50/50).
  const { data: h0 } = await admin.from('market_prices_history').select('yes_pool,no_pool').eq('market_id', id).order('created_at', { ascending: true }).limit(1).single()
  const y0 = Number(h0.yes_pool)
  const n0 = Number(h0.no_pool)
  const diff = Math.abs(Number(m.yes_pool) + sy - y0 - (Number(m.no_pool) + sn - n0))
  const k = Number(m.yes_pool) * Number(m.no_pool)
  if (diff > 1e-3 || Math.abs(k - y0 * n0) / (y0 * n0) > 1e-7 || Math.abs(y0 * n0 - L0 * L0) / (L0 * L0) > 1e-6) {
    bad += 1
    console.log(`  ❌ mercado ${id.slice(0, 8)}: diff tokens=${diff.toExponential(2)} k=${k}`)
  }
}
let neg = 0
for (const pl of players) {
  const { data } = await pl.c.from('profiles').select('balance').eq('id', pl.id).single()
  if (Number(data.balance) < 0) neg += 1
}
console.log(bad === 0 ? `  ✅ ${created.length} mercados: tokens conservados (YES pool+ΣYES = NO pool+ΣNO) y producto k constante` : `  ❌ ${bad} mercados con invariantes rotas`)
console.log(neg === 0 ? `  ✅ ${players.length} jugadores: ningún saldo negativo` : `  ❌ ${neg} saldos negativos`)

// ---------- limpieza ----------
for (const id of created) await admin.rpc('delete_market_and_refund', { p_market_id: id })
console.log('\n🧹 mercados de prueba anulados y reembolsados')
process.exit(bad || neg ? 1 : 0)
