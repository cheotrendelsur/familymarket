// =====================================================================
// FamilyMarket · AUDITORÍA DE CÁLCULOS contra el servidor real (aleatoria y con semilla)
//   LOADTEST_ENV=/ruta/testenv.json [AUDIT_SEED=123] [AUDIT_OPS=450] node scripts/audit.mjs
//
// Ejecuta cientos de compras y ventas aleatorias entre 12 jugadores de prueba y comprueba:
//   1. PARIDAD: lo que devuelve el servidor (acciones, precio medio, comisión, precio final,
//      piscinas, saldo) coincide con la cotización del frontend (src/lib/trading.js) y, cuando
//      el frontend dice "error" (tope de 99 ¢ / 1 ¢), el servidor también rechaza.
//   2. INVARIANTES del mercado: k = yes*no constante; acciones SÍ y NO conservadas
//      (yes_jugadores + yes_piscina = no_jugadores + no_piscina); precios dentro de [1 ¢, 99 ¢].
//   3. LIBRO CONTABLE: el saldo de cada jugador = $1000 + Σ ventas − Σ compras (+ pagos).
//   4. RANKING y PORTAFOLIO: patrimonio = efectivo + Σ acciones × precio; costo promedio.
//   5. RESOLUCIÓN: pagos exactos ($1 por acción ganadora), avisos con ganancia correcta,
//      estadísticas del perfil, y la identidad: Σ ganancia de jugadores = L − piscina_ganadora − comisiones.
//   6. ANULAR, DESHACER RESOLUCIÓN y volver a resolver devuelven el dinero exacto.
// Los usuarios de prueba (@loadtest.invalid) son temporales: ver docs/AUDITORIA.md.
// =====================================================================
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CONFIG, newRequestId, quoteBuy, quoteSell, spotPrice } from '../src/lib/trading.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_FILE = process.env.LOADTEST_ENV
if (!ENV_FILE) throw new Error('Define LOADTEST_ENV con la ruta al archivo de credenciales de prueba')
const cfgEnv = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'))
const dot = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const URL_ = dot.VITE_SUPABASE_URL
const KEY = dot.VITE_SUPABASE_ANON_KEY

const SEED = Number(process.env.AUDIT_SEED || Math.floor(Math.random() * 1e9))
const OPS = Number(process.env.AUDIT_OPS || 450)
const PLAYERS = 12 // lt_01 .. lt_12 juegan; lt_00 es el dueño; lt_13 es el "ballena" de los extremos

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rng(SEED)
const pick = (arr) => arr[Math.floor(rand() * arr.length)]

let passed = 0
let failed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) passed += 1
  else {
    failed += 1
    failures.push(`${name} ${detail}`)
    console.log(`  ❌ ${name} ${detail}`)
  }
}
const section = (t) => console.log(`\n━━ ${t} ━━`)
const near = (a, b, tol) => Math.abs(a - b) <= tol
const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b))
const N = (x) => Number(x)
const r4 = (x) => Math.round((x + Number.EPSILON) * 1e4) / 1e4

const mk = (token) =>
  createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: token ? { Authorization: `Bearer ${token}` } : {} } })

async function login(i) {
  const email = `${cfgEnv.prefix}${String(i).padStart(2, '0')}@${cfgEnv.domain}`
  const c = mk()
  const { data, error } = await c.auth.signInWithPassword({ email, password: cfgEnv.password })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return { i, id: data.user.id, c: mk(data.session.access_token) }
}

const rpc = async (u, fn, args = {}) => {
  const { data, error } = await u.c.rpc(fn, args)
  return { data, error, msg: error?.message || '' }
}

// ---------------------------------------------------------------------
const admin = await login(0)
const players = []
for (let i = 1; i <= PLAYERS; i += 1) players.push(await login(i))
const whale = await login(13)
const everyone = [admin, ...players, whale]

const { data: gs } = await admin.c.from('game_settings').select('*').single()
const CFG = {
  ...DEFAULT_CONFIG,
  daily_limit: N(gs.daily_limit),
  fee_rate: N(gs.fee_rate),
  initial_liquidity: N(gs.initial_liquidity),
  initial_balance: N(gs.initial_balance),
  min_price: N(gs.min_price),
  max_price: N(gs.max_price),
  min_trade: N(gs.min_trade),
}
const L = CFG.initial_liquidity
console.log(`Semilla ${SEED} · ${OPS} operaciones · liquidez ${L} · comisión ${CFG.fee_rate * 100} % · límite diario ${CFG.daily_limit}`)

const balanceOf = async (u) => N((await u.c.from('profiles').select('balance').eq('id', u.id).single()).data.balance)
const readMarket = async (id) => (await admin.c.from('markets').select('*').eq('id', id).maybeSingle()).data
const myShares = async (u, mid) => {
  const out = { YES: 0, NO: 0 }
  const { data } = await u.c.from('shares').select('side, count').eq('market_id', mid)
  for (const r of data || []) out[r.side] = N(r.count)
  return out
}
const myTxs = async (u, mid) => (await u.c.from('transactions').select('*').eq('market_id', mid)).data || []

// ---------------------------------------------------------------------
section('0 · Estado inicial')
for (const u of everyone) {
  check(`saldo inicial de lt_${String(u.i).padStart(2, '0')} = ${CFG.initial_balance}`, near(await balanceOf(u), CFG.initial_balance, 1e-6))
  const used = (await u.c.rpc('get_daily_moves')).data?.used
  check(`movimientos del día de lt_${String(u.i).padStart(2, '0')} en 0 (si no, limpia transaction_logs de prueba)`, used === 0, String(used))
}

// restos de una ejecución interrumpida
{
  const { data: left } = await admin.c.from('markets').select('id').like('question', '[AUDIT]%')
  for (const m of left || []) await rpc(admin, 'delete_market_and_refund', { p_market_id: m.id })
}
// 5 mercados de prueba
const markets = []
for (let k = 0; k < 5; k += 1) {
  const r = await rpc(admin, 'staff_create_market', { p_question: `[AUDIT] mercado ${k + 1}`, p_description: 'auditoría' })
  check(`crea mercado ${k + 1}`, !r.error && typeof r.data === 'string', r.msg)
  markets.push(r.data)
}
for (const id of markets) {
  const m = await readMarket(id)
  check('mercado nuevo nace 50 / 50 con la liquidez configurada', N(m.yes_pool) === L && N(m.no_pool) === L && !m.closed)
}

let crashed = null
try {
// ---------------------------------------------------------------------
section(`1 · Paridad servidor ↔ frontend en ${OPS} operaciones aleatorias`)
// Libro contable propio (en micro-unidades para no acumular error de coma flotante)
const ledger = new Map(everyone.map((u) => [u.id, { cash: CFG.initial_balance, moves: 0 }]))
const hold = new Map() // `${uid}|${mid}|${side}` -> acciones
const key = (u, m, s) => `${u.id}|${m}|${s}`
const getHold = (u, m, s) => hold.get(key(u, m, s)) || 0
const addHold = (u, m, s, d) => hold.set(key(u, m, s), Math.round((getHold(u, m, s) + d) * 1e6) / 1e6)

let buys = 0
let sells = 0
let cappedBuys = 0
let cappedSells = 0
let maxPoolDrift = 0
let maxShareErr = 0
let maxMoneyErr = 0
const tradeMarkets = markets.slice(0, 4) // el 5.º queda para anular/otros
const stats = { stakes: [] }

for (let n = 0; n < OPS; n += 1) {
  const u = pick(players)
  const led = ledger.get(u.id)
  if (led.moves >= CFG.daily_limit - 2) continue
  const mid = pick(tradeMarkets)
  const canBuy = led.cash >= CFG.min_trade // un jugador sin dinero solo puede vender
  const m = await readMarket(mid)
  const owned = { YES: getHold(u, mid, 'YES'), NO: getHold(u, mid, 'NO') }
  const canSell = owned.YES > 0 || owned.NO > 0
  const doSell = canSell && (!canBuy || rand() < 0.42)
  if (!canSell && !canBuy) continue

  if (!doSell) {
    const side = rand() < 0.5 ? 'YES' : 'NO'
    // importes en escala logarítmica: de $0.01 a $400
    let amount = r4(Math.exp(Math.log(0.01) + rand() * (Math.log(400) - Math.log(0.01))))
    amount = Math.max(CFG.min_trade, Math.min(amount, r4(led.cash)))
    if (amount < CFG.min_trade) continue
    const q = quoteBuy(m, side, amount, CFG)
    const res = await rpc(u, 'buy_shares', { p_market_id: mid, p_side: side, p_investment: amount, p_request_id: newRequestId() })
    led.moves += res.error ? 0 : 1
    if (q.error) {
      check(`COMPRA rechazada por ambos (${q.error.slice(0, 22)}…)`, !!res.error, `servidor aceptó $${amount} ${side}`)
      cappedBuys += 1
      continue
    }
    if (res.error) {
      check('COMPRA aceptada por ambos', false, `servidor: ${res.msg} · $${amount} ${side} · pools ${m.yes_pool}/${m.no_pool}`)
      continue
    }
    buys += 1
    stats.stakes.push(amount)
    const d = res.data
    const shareErr = Math.abs(N(d.shares_bought) - q.shares)
    maxShareErr = Math.max(maxShareErr, shareErr)
    check('COMPRA acciones = frontend (±2e-6)', shareErr <= 2e-6, `srv ${d.shares_bought} vs front ${q.shares} · $${amount} ${side}`)
    check('COMPRA comisión = frontend (±1e-4)', near(N(d.fee_paid), q.fee, 1.0001e-4))
    check('COMPRA precio final = frontend', near(N(d.final_price), q.finalPrice, 1e-9))
    check('COMPRA piscinas = frontend', rel(N(d.yes_pool), q.newYesPool) < 1e-9 && rel(N(d.no_pool), q.newNoPool) < 1e-9)
    maxPoolDrift = Math.max(maxPoolDrift, rel(N(d.yes_pool) * N(d.no_pool), L * L))
    // sanidad económica: el precio medio sin comisión queda entre el precio antes y el precio después
    const avgNet = (amount - N(d.fee_paid)) / N(d.shares_bought)
    const p0 = spotPrice(m, side)
    const p1 = N(d.final_price)
    const tolB = 1.5e-4 / N(d.shares_bought) + 1e-7 // el dinero se redondea a 4 decimales: en operaciones diminutas pesa
    check('COMPRA precio medio (sin comisión) entre precio antes y después', avgNet >= p0 - tolB && avgNet <= p1 + tolB, `${p0} ≤ ${avgNet} ≤ ${p1}`)
    const expectedCash = r4(led.cash - amount)
    maxMoneyErr = Math.max(maxMoneyErr, Math.abs(N(d.new_balance) - expectedCash))
    check('COMPRA nuevo saldo = saldo − inversión', near(N(d.new_balance), expectedCash, 1e-4), `${d.new_balance} vs ${expectedCash}`)
    led.cash = N(d.new_balance)
    addHold(u, mid, side, N(d.shares_bought))
  } else {
    const side = owned.YES > 0 && (owned.NO === 0 || rand() < 0.5) ? 'YES' : 'NO'
    const have = owned[side] || owned[side === 'YES' ? 'NO' : 'YES']
    const useSide = owned[side] > 0 ? side : side === 'YES' ? 'NO' : 'YES'
    const f = rand()
    const count = getHold(u, mid, useSide)
    const toSell = f < 0.25 ? count : f < 0.5 ? Math.round(count * 0.5 * 1e6) / 1e6 : Math.max(1e-6, Math.round(count * rand() * 1e6) / 1e6)
    if (!(toSell > 0) || !have) continue
    const q = quoteSell(m, useSide, toSell, CFG)
    const res = await rpc(u, 'sell_shares', { p_market_id: mid, p_side: useSide, p_shares_to_sell: toSell, p_request_id: newRequestId() })
    led.moves += res.error ? 0 : 1
    if (q.error) {
      check(`VENTA rechazada por ambos (${q.error.slice(0, 22)}…)`, !!res.error, `servidor aceptó ${toSell} ${useSide}`)
      cappedSells += 1
      continue
    }
    if (res.error) {
      // ventas minúsculas con pago redondeado a 0 son rechazadas por ambos
      check('VENTA aceptada por ambos', false, `servidor: ${res.msg} · ${toSell} ${useSide}`)
      continue
    }
    sells += 1
    const d = res.data
    check('VENTA pago = frontend (±1e-4)', near(N(d.payout), q.payout, 1.0001e-4), `srv ${d.payout} vs front ${q.payout}`)
    check('VENTA comisión = frontend (±1e-4)', near(N(d.fee_paid), q.fee, 1.0001e-4))
    check('VENTA precio final = frontend', near(N(d.final_price), q.finalPrice, 1e-9))
    check('VENTA piscinas = frontend', rel(N(d.yes_pool), q.newYesPool) < 1e-9 && rel(N(d.no_pool), q.newNoPool) < 1e-9)
    maxPoolDrift = Math.max(maxPoolDrift, rel(N(d.yes_pool) * N(d.no_pool), L * L))
    const p0 = spotPrice(m, useSide)
    const p1 = N(d.final_price)
    const avgNet = (N(d.payout) + N(d.fee_paid)) / toSell
    const tolS = 1.5e-4 / toSell + 1e-7
    check('VENTA precio medio (sin comisión) entre precio después y antes', avgNet <= p0 + tolS && avgNet >= p1 - tolS, `${p1} ≤ ${avgNet} ≤ ${p0}`)
    const expectedCash = r4(led.cash + N(d.payout))
    check('VENTA nuevo saldo = saldo + pago', near(N(d.new_balance), expectedCash, 1e-4), `${d.new_balance} vs ${expectedCash}`)
    led.cash = N(d.new_balance)
    addHold(u, mid, useSide, -toSell)
  }
}
console.log(`  · ${buys} compras y ${sells} ventas ejecutadas; ${cappedBuys} compras / ${cappedSells} ventas rechazadas por tope (de común acuerdo)`)
console.log(`  · mayor error de acciones: ${maxShareErr.toExponential(2)} · de saldo: ${maxMoneyErr.toExponential(2)} · deriva máx. de k: ${maxPoolDrift.toExponential(2)}`)
check('se ejecutaron suficientes operaciones para que la prueba valga', buys + sells >= OPS * 0.7, `${buys + sells}/${OPS}`)

// ---------------------------------------------------------------------
section('2 · Invariantes de cada mercado')
for (const mid of tradeMarkets) {
  const m = await readMarket(mid)
  const yes = N(m.yes_pool)
  const no = N(m.no_pool)
  check('k = yes·no se conserva', rel(yes * no, L * L) < 1e-8, `k=${yes * no}`)
  let uy = 0
  let un = 0
  for (const u of players) {
    const s = await myShares(u, mid)
    uy += s.YES
    un += s.NO
    check('acciones en base de datos = acciones calculadas por el libro', near(s.YES, getHold(u, mid, 'YES'), 1e-6) && near(s.NO, getHold(u, mid, 'NO'), 1e-6), `${s.YES}/${s.NO} vs ${getHold(u, mid, 'YES')}/${getHold(u, mid, 'NO')}`)
  }
  check('acciones SÍ y NO conservadas (yes_jug+yes_pool = no_jug+no_pool)', near(uy + yes, un + no, 1e-4), `${uy + yes} vs ${un + no}`)
  const py = no / (yes + no)
  check('precio de Sí dentro de [1 ¢, 99 ¢]', py >= CFG.min_price - 1e-9 && py <= CFG.max_price + 1e-9, String(py))
}

// ---------------------------------------------------------------------
section('3 · Libro contable (saldos)')
for (const u of players) {
  const bal = await balanceOf(u)
  const txs = []
  for (const mid of tradeMarkets) txs.push(...(await myTxs(u, mid)))
  const flow = txs.reduce((s, t) => s + (t.type === 'BUY' ? -N(t.total_cost) : t.type === 'SELL' ? N(t.total_cost) : 0), 0)
  check(`saldo de lt_${String(u.i).padStart(2, '0')} = 1000 + ventas − compras`, near(bal, CFG.initial_balance + flow, 2e-3), `${bal} vs ${CFG.initial_balance + flow}`)
  check('saldo nunca negativo', bal >= 0)
  check('saldo = libro corrido', near(bal, ledger.get(u.id).cash, 1e-4))
  const logs = await u.c.rpc('get_daily_moves')
  check('movimientos usados = operaciones hechas', logs.data?.used === ledger.get(u.id).moves, `${logs.data?.used} vs ${ledger.get(u.id).moves}`)
}

// ---------------------------------------------------------------------
section('4 · Ranking, patrimonio y portafolio')
const lb = (await rpc(players[0], 'get_leaderboard')).data
const marketRows = new Map()
for (const mid of markets) marketRows.set(mid, await readMarket(mid))
let rankedOk = true
for (let k = 1; k < lb.length; k += 1) if (N(lb[k - 1].net_worth) < N(lb[k].net_worth) - 1e-9) rankedOk = false
check('ranking ordenado de mayor a menor patrimonio', rankedOk)
check('posiciones consecutivas 1..n', lb.every((r, k) => N(r.rank) === k + 1))
for (const u of players) {
  const row = lb.find((r) => r.user_id === u.id)
  let pos = 0
  for (const mid of tradeMarkets) {
    const m = marketRows.get(mid)
    pos += getHold(u, mid, 'YES') * spotPrice(m, 'YES') + getHold(u, mid, 'NO') * spotPrice(m, 'NO')
  }
  const bal = ledger.get(u.id).cash
  check(`patrimonio de lt_${String(u.i).padStart(2, '0')} = efectivo + Σ acciones × precio`, near(N(row.net_worth), bal + pos, 1e-3), `${row.net_worth} vs ${bal + pos}`)
  check('efectivo del ranking = saldo', near(N(row.cash), bal, 1e-4))
}
// portafolio y costo promedio (independiente: promedio ponderado con ventas proporcionales)
for (const u of players.slice(0, 6)) {
  const pf = (await rpc(u, 'get_my_portfolio')).data
  for (const p of pf.positions) {
    const txs = (await myTxs(u, p.market_id)).filter((t) => t.side === p.side && (t.type === 'BUY' || t.type === 'SELL')).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
    let sh = 0
    let cost = 0
    for (const t of txs) {
      if (t.type === 'BUY') {
        cost += N(t.total_cost)
        sh += N(t.shares_amount)
      } else if (sh > 0) {
        cost -= cost * Math.min(N(t.shares_amount) / sh, 1)
        sh = Math.max(sh - N(t.shares_amount), 0)
      }
    }
    const avg = sh > 0 ? cost / sh : 0
    check('costo promedio del portafolio coincide con el recálculo', near(N(p.avg_cost), avg, 1e-6), `${p.avg_cost} vs ${avg}`)
    check('acciones del portafolio = acciones reales', near(N(p.shares), getHold(u, p.market_id, p.side), 1e-6))
    check('costo promedio entre 0 y 1 dólar por acción', avg > 0 && avg < 1)
  }
}

// ---------------------------------------------------------------------
section('5 · Resolución: pagos, avisos, estadísticas e identidad contable')
const resolvedInfo = []
async function resolveAndAudit(mid, outcome) {
  const m = await readMarket(mid)
  const before = new Map()
  for (const u of players) before.set(u.id, await balanceOf(u))
  const holds = new Map(players.map((u) => [u.id, { YES: getHold(u, mid, 'YES'), NO: getHold(u, mid, 'NO') }]))
  const res = await rpc(admin, 'resolve_market', { p_market_id: mid, p_outcome: outcome })
  check(`resolver ${outcome}`, !res.error, res.msg)
  const winTotal = players.reduce((s, u) => s + holds.get(u.id)[outcome], 0)
  check('total pagado = Σ acciones ganadoras', near(N(res.data?.total_paid), winTotal, 1e-4), `${res.data?.total_paid} vs ${winTotal}`)
  const txsAll = []
  for (const u of players) {
    const bal = await balanceOf(u)
    const win = holds.get(u.id)[outcome]
    check(`pago a lt_${String(u.i).padStart(2, '0')} = ${win.toFixed(4)} (1 $ por acción ganadora)`, near(bal - before.get(u.id), win, 1.1e-4), `${bal - before.get(u.id)} vs ${win}`)
    txsAll.push(...(await myTxs(u, mid)).map((t) => ({ ...t, uid: u.id })))
  }
  // identidad contable: Σ ganancia de jugadores = L − piscina_ganadora − comisiones
  const poolWin = N(outcome === 'YES' ? m.yes_pool : m.no_pool)
  let profit = 0
  let fees = 0
  for (const t of txsAll) {
    if (t.type === 'BUY') {
      profit -= N(t.total_cost)
      fees += r4(N(t.total_cost) * CFG.fee_rate)
    } else if (t.type === 'SELL') {
      profit += N(t.total_cost)
      fees += N(t.total_cost) * (CFG.fee_rate / (1 - CFG.fee_rate))
    } else if (t.type === 'RESOLVE') profit += N(t.total_cost)
  }
  check('IDENTIDAD: Σ ganancias jugadores = L − piscina_ganadora − comisiones', near(profit, L - poolWin - fees, 0.05 + 2e-4 * txsAll.length), `${profit.toFixed(4)} vs ${(L - poolWin - fees).toFixed(4)}`)
  check('el dinero creado por el mercado no supera la liquidez (L)', profit <= L + 1e-6, `${profit}`)
  // avisos de victoria / derrota
  for (const u of players) {
    const h = holds.get(u.id)
    if (h.YES + h.NO <= 0) continue
    const st = (await rpc(u, 'get_session_state')).data
    const note = (st.notifications || []).find((x) => x.market_id === mid && (x.kind === 'MARKET_WON' || x.kind === 'MARKET_LOST'))
    check('aviso de resultado recibido', !!note)
    if (!note) continue
    const mine = txsAll.filter((t) => t.uid === u.id)
    const invested = mine.reduce((s, t) => s + (t.type === 'BUY' ? N(t.total_cost) : t.type === 'SELL' ? -N(t.total_cost) : 0), 0)
    const payout = h[outcome]
    check('aviso: tipo correcto', note.kind === (payout > 0 ? 'MARKET_WON' : 'MARKET_LOST'))
    check('aviso: pago correcto', near(N(note.payload.payout), payout, 1e-4))
    check('aviso: invertido neto correcto', near(N(note.payload.invested), invested, 2e-3), `${note.payload.invested} vs ${invested}`)
    check('aviso: ganancia = pago − invertido', near(N(note.payload.profit), payout - invested, 3e-3), `${note.payload.profit} vs ${payout - invested}`)
  }
  resolvedInfo.push({ mid, outcome })
  return { before, holds, txsAll }
}
const r1 = await resolveAndAudit(markets[0], 'YES')
const r2 = await resolveAndAudit(markets[1], 'NO')

// estadísticas de perfil contra recálculo independiente (solo mercados resueltos)
for (const u of players.slice(0, 8)) {
  let pl = 0
  let wins = 0
  let losses = 0
  for (const { mid } of resolvedInfo) {
    const txs = await myTxs(u, mid)
    if (!txs.length) continue
    const p = txs.reduce((s, t) => s + (t.type === 'BUY' ? -N(t.total_cost) : N(t.total_cost)), 0)
    if (r4(p) === 0) continue
    pl += p
    if (p > 0) wins += 1
    else losses += 1
  }
  const prof = (await rpc(players[0], 'get_player_profile', { p_user_id: u.id })).data
  check(`perfil lt_${String(u.i).padStart(2, '0')}: aciertos/fallos`, prof.wins === wins && prof.losses === losses, `${prof.wins}/${prof.losses} vs ${wins}/${losses}`)
  check('perfil: ganancia realizada', near(N(prof.realized_pl), pl, 2e-3), `${prof.realized_pl} vs ${pl}`)
  check('perfil: tasa de aciertos', wins + losses === 0 ? prof.win_rate === null : near(N(prof.win_rate), wins / (wins + losses), 1e-3))
}
// tras resolver, ya no se puede operar ahí
const afterRes = await rpc(players[0], 'buy_shares', { p_market_id: markets[0], p_side: 'YES', p_investment: 5, p_request_id: newRequestId() })
check('no se puede comprar en un mercado resuelto', !!afterRes.error, afterRes.msg)

// ---------------------------------------------------------------------
section('6 · Deshacer una resolución y volver a resolver')
{
  const mid = markets[0]
  const before = new Map()
  for (const u of players) before.set(u.id, await balanceOf(u))
  const reopen = await rpc(admin, 'admin_reopen_market', { p_market_id: mid })
  check('deshacer resolución', !reopen.error, reopen.msg)
  const m = await readMarket(mid)
  check('el mercado vuelve a estar abierto y pendiente', !m.closed && m.outcome === 'PENDING')
  for (const u of players) {
    // al deshacer, a cada jugador se le descuenta exactamente lo que cobró de ESTE mercado (el otro resuelto no se toca)
    const was = Math.max(before.get(u.id) - r1.holds.get(u.id).YES, 0)
    const now = await balanceOf(u)
    check(`saldo de lt_${String(u.i).padStart(2, '0')} = saldo − lo cobrado de este mercado`, near(now, was, 2e-4), `${now} vs ${was}`)
    const s = await myShares(u, mid)
    check('sus acciones siguen intactas', near(s.YES, getHold(u, mid, 'YES'), 1e-6) && near(s.NO, getHold(u, mid, 'NO'), 1e-6))
  }
  const again = await rpc(players[1], 'buy_shares', { p_market_id: mid, p_side: 'NO', p_investment: 7, p_request_id: newRequestId() })
  check('se puede volver a operar en el mercado reabierto', !again.error, again.msg)
  if (!again.error) {
    addHold(players[1], mid, 'NO', N(again.data.shares_bought))
    ledger.get(players[1].id).cash = N(again.data.new_balance)
  }
  await resolveAndAudit(mid, 'NO') // se resuelve al revés y se vuelve a auditar todo
}

// ---------------------------------------------------------------------
section('7 · Anular un mercado devuelve el dinero exacto')
{
  const mid = markets[2]
  const before = new Map()
  const nets = new Map()
  for (const u of players) {
    before.set(u.id, await balanceOf(u))
    const txs = await myTxs(u, mid)
    nets.set(u.id, txs.reduce((s, t) => s + (t.type === 'BUY' ? N(t.total_cost) : t.type === 'SELL' ? -N(t.total_cost) : 0), 0))
  }
  const del = await rpc(admin, 'delete_market_and_refund', { p_market_id: mid })
  check('anular mercado', !del.error, del.msg)
  for (const u of players) {
    const now = await balanceOf(u)
    const expected = Math.max(before.get(u.id) + nets.get(u.id), 0)
    check(`reembolso de lt_${String(u.i).padStart(2, '0')} = compras − ventas`, near(now, expected, 2e-4), `${now} vs ${expected}`)
  }
  check('el mercado anulado desaparece', (await readMarket(mid)) === null)
}

// ---------------------------------------------------------------------
section('8 · Extremos: mínimo, topes de 99 ¢ / 1 ¢ y apostador con mucho dinero')
{
  const fund = await rpc(admin, 'admin_update_balance', { p_user_id: whale.id, p_amount: 60000 })
  check('financiar al "ballena" de prueba', !fund.error, fund.msg)
  const mid = markets[4]
  let cash = await balanceOf(whale)
  let moves = 0
  const hit = { capBuy: false, capSell: false }
  // 0.01 mínimo
  const tiny = await rpc(whale, 'buy_shares', { p_market_id: mid, p_side: 'YES', p_investment: CFG.min_trade, p_request_id: newRequestId() })
  moves += 1
  check('compra mínima ($0.01) se acepta y da acciones > 0', !tiny.error && N(tiny.data.shares_bought) > 0, tiny.msg)
  const below = await rpc(whale, 'buy_shares', { p_market_id: mid, p_side: 'YES', p_investment: CFG.min_trade / 10, p_request_id: newRequestId() })
  check('compra bajo el mínimo se rechaza', !!below.error)
  // empuja el precio hacia el tope con apuestas grandes y compara el punto exacto de corte
  for (let n = 0; n < 40 && moves < CFG.daily_limit - 4; n += 1) {
    const m = await readMarket(mid)
    const side = n % 7 === 6 ? 'NO' : 'YES'
    const amount = r4(Math.min(cash, 800 + rand() * 6000))
    const q = quoteBuy(m, side, amount, CFG)
    const res = await rpc(whale, 'buy_shares', { p_market_id: mid, p_side: side, p_investment: amount, p_request_id: newRequestId() })
    moves += res.error ? 0 : 1
    if (q.error) {
      hit.capBuy = true
      check('tope de precio: el servidor rechaza igual que el frontend', !!res.error && /excedería|límite/i.test(res.msg), res.msg)
      // bisección de la inversión máxima aceptable y prueba a ambos lados del corte
      let lo = CFG.min_trade
      let hi = amount
      for (let k = 0; k < 40; k += 1) {
        const mid2 = (lo + hi) / 2
        if (quoteBuy(m, side, mid2, CFG).error) hi = mid2
        else lo = mid2
      }
      const ok = await rpc(whale, 'buy_shares', { p_market_id: mid, p_side: side, p_investment: r4(lo * 0.9999), p_request_id: newRequestId() })
      moves += ok.error ? 0 : 1
      check('justo debajo del tope se acepta', !ok.error, ok.msg)
      const bad = await rpc(whale, 'buy_shares', { p_market_id: mid, p_side: side, p_investment: r4(hi * 1.0001 + 0.0002), p_request_id: newRequestId() })
      check('justo encima del tope se rechaza', !!bad.error, bad.msg)
      break
    } else if (!res.error) {
      cash = N(res.data.new_balance)
    }
  }
  check('se llegó al tope de 99 ¢ durante la prueba', hit.capBuy)
  const wm = await readMarket(mid)
  const py = N(wm.no_pool) / (N(wm.yes_pool) + N(wm.no_pool))
  check('el precio quedó dentro de [1 ¢, 99 ¢] tras el castigo', py >= CFG.min_price && py <= CFG.max_price, String(py))
  // venta enorme: intenta bajar el precio por debajo de 1 ¢
  const sh = await myShares(whale, mid)
  const side = sh.YES >= sh.NO ? 'YES' : 'NO'
  const big = side === 'YES' ? sh.YES : sh.NO
  const q = quoteSell(wm, side, big, CFG)
  const sold = await rpc(whale, 'sell_shares', { p_market_id: mid, p_side: side, p_shares_to_sell: big, p_request_id: newRequestId() })
  if (q.error) {
    hit.capSell = true
    check('venta que rompería el mínimo de 1 ¢: ambos rechazan', !!sold.error, sold.msg)
  } else {
    check('venta total: servidor = frontend', !sold.error && near(N(sold.data.payout), q.payout, 1.0001e-4), sold.msg)
  }
  const tooMany = await rpc(whale, 'sell_shares', { p_market_id: mid, p_side: side, p_shares_to_sell: big + 1000, p_request_id: newRequestId() })
  check('no se pueden vender más acciones de las que se tienen', !!tooMany.error, tooMany.msg)
  // idempotencia: repetir el mismo request_id no duplica la operación
  const rid = newRequestId()
  const before = await balanceOf(whale)
  const a = await rpc(whale, 'buy_shares', { p_market_id: mid, p_side: 'NO', p_investment: 10, p_request_id: rid })
  const b = await rpc(whale, 'buy_shares', { p_market_id: mid, p_side: 'NO', p_investment: 10, p_request_id: rid })
  const afterBal = await balanceOf(whale)
  check('mismo request_id dos veces cobra una sola vez', !a.error && !b.error && near(before - afterBal, 10, 1e-4) && a.data.shares_bought === b.data.shares_bought, `${before - afterBal}`)
  // idas y vueltas: comprar y vender enseguida solo cuesta las comisiones (el mercado queda como estaba)
  const m0 = await readMarket(mid)
  const buy = await rpc(whale, 'buy_shares', { p_market_id: mid, p_side: 'YES', p_investment: 100, p_request_id: newRequestId() })
  const back = buy.error ? { error: buy.error } : await rpc(whale, 'sell_shares', { p_market_id: mid, p_side: 'YES', p_shares_to_sell: buy.data.shares_bought, p_request_id: newRequestId() })
  if (!buy.error && !back.error) {
    const m1 = await readMarket(mid)
    check('ida y vuelta: las piscinas regresan a su valor', rel(N(m1.yes_pool), N(m0.yes_pool)) < 1e-7 && rel(N(m1.no_pool), N(m0.no_pool)) < 1e-7)
    const loss = 100 - N(back.data.payout)
    check('ida y vuelta: pérdida = comisión comprando + vendiendo (≈ 3.96 %)', near(loss, 100 * (1 - 0.98 * 0.98), 0.01), `${loss}`)
  } else {
    check('ida y vuelta ejecutada', false, buy.msg || back.error?.message)
  }
  check('el servidor respeta el límite diario con tantas operaciones', moves <= CFG.daily_limit)
}


// ---------------------------------------------------------------------
section('10 · Mercados de varias opciones: arranque justo (suma 100 %) y sin ganancia segura')
const groupIds = []
for (const n of [2, 3, 4, 7]) {
  const g = await rpc(admin, 'staff_create_market_group', { p_topic: `[AUDIT] grupo de ${n}`, p_options: Array.from({ length: n }, (_, k) => `Opción ${k + 1}`) })
  check(`crea grupo de ${n} opciones`, !g.error && g.data?.ids?.length === n, g.msg)
  if (g.error) continue
  groupIds.push(...g.data.ids)
  let sum = 0
  for (const id of g.data.ids) {
    const m = await readMarket(id)
    const py = N(m.no_pool) / (N(m.yes_pool) + N(m.no_pool))
    sum += py
    check(`grupo de ${n}: cada opción nace al ${(100 / n).toFixed(2)} %`, near(py, 1 / n, 1e-9), String(py))
    check(`grupo de ${n}: k = L²`, rel(N(m.yes_pool) * N(m.no_pool), L * L) < 1e-7)
    const h = (await admin.c.rpc('get_market_history', { p_market_id: id, p_limit: 5 })).data
    check(`grupo de ${n}: historial inicial = precio inicial (6 decimales)`, near(N(h[0].yes_price), 1 / n, 1e-6))
  }
  check(`grupo de ${n}: la suma de «Sí» es 100 %`, near(sum, 1, 1e-9), String(sum))
}
{
  // ya no existe la ganancia segura de «comprar No en todas las opciones»
  const gid = groupIds.slice(2, 5) // el grupo de 3
  const u = admin // el dueño también juega y no gastó nada en el fuzz (los jugadores pueden haber quedado sin saldo)
  let cost = 0
  const sharesNo = []
  for (const id of gid) {
    const r = await rpc(u, 'buy_shares', { p_market_id: id, p_side: 'NO', p_investment: 100, p_request_id: newRequestId() })
    check('compra de «No» en cada opción', !r.error, r.msg)
    if (r.error) continue
    cost += 100
    sharesNo.push(N(r.data.shares_bought))
  }
  const worst = sharesNo.reduce((a, b) => a + b, 0) - Math.max(...sharesNo) // si gana la opción donde más «No» tiene
  check('SIN ARBITRAJE: peor caso de «No» en todas las opciones paga menos de lo invertido', worst < cost, `peor caso ${worst.toFixed(2)} vs costo ${cost}`)
  // resolver con ganador y sin ganador
  const win = await rpc(admin, 'resolve_market', { p_market_id: gid[0], p_outcome: 'YES' })
  check('resolver opción ganadora', !win.error, win.msg)
  for (const id of gid.slice(1)) check('resolver opción perdedora (No)', !(await rpc(admin, 'resolve_market', { p_market_id: id, p_outcome: 'NO' })).error)
}
for (const id of groupIds) {
  const m = await readMarket(id)
  if (m) await rpc(admin, 'delete_market_and_refund', { p_market_id: id })
}
} catch (e) {
  crashed = e
  failed += 1
  failures.push(`la auditoría se interrumpió: ${e?.stack || e}`)
  console.log('💥 la auditoría se interrumpió:', e?.stack || e)
}

// ---------------------------------------------------------------------
section('9 · Limpieza de mercados de prueba')
for (const mid of markets) {
  const m = await readMarket(mid)
  if (!m) continue
  const r = await rpc(admin, 'delete_market_and_refund', { p_market_id: mid })
  check('mercado de prueba eliminado', !r.error, r.msg)
}

console.log(`\n══════ AUDITORÍA: ${passed} verificaciones correctas, ${failed} con fallo (semilla ${SEED}) ══════`)
if (failed) {
  console.log('Fallos:')
  failures.slice(0, 40).forEach((f) => console.log(' -', f))
  process.exit(1)
}
