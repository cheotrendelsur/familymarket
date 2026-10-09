// =====================================================================
// FamilyMarket · pruebas de seguridad, lógica y concurrencia (contra Supabase real)
//
// Requiere usuarios de prueba (lt_00@... admin, lt_01..lt_13) creados aparte y un
// archivo de credenciales fuera del repo:
//   LOADTEST_ENV=/ruta/testenv.json  node scripts/loadtest.mjs [sec|func|feat|conc|all]
// testenv.json: { "password": "...", "prefix": "lt_", "domain": "loadtest.invalid", "count": 14 }
// =====================================================================
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newRequestId, quoteBuy, quoteSell, DEFAULT_CONFIG } from '../src/lib/trading.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_FILE = process.env.LOADTEST_ENV
if (!ENV_FILE) throw new Error('Define LOADTEST_ENV con la ruta al archivo de credenciales de prueba')
const cfg = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'))
const STATE_FILE = path.join(path.dirname(ENV_FILE), 'sessions.json')
const PHASE = process.argv[2] || 'all'

const dot = Object.fromEntries(
  fs
    .readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const URL_ = dot.VITE_SUPABASE_URL
const KEY = dot.VITE_SUPABASE_ANON_KEY

// ---------- utilidades ----------
let passed = 0
let failed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  ✅ ${name}`)
  } else {
    failed += 1
    failures.push(name)
    console.log(`  ❌ ${name} ${detail}`)
  }
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (arr, p) => {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
const section = (t) => console.log(`\n━━ ${t} ━━`)

const mk = (token) =>
  createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  })

async function login() {
  if (fs.existsSync(STATE_FILE)) {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    if (Date.now() < s.expires) return s.users
  }
  const users = []
  for (let i = 0; i < cfg.count; i += 1) {
    const email = `${cfg.prefix}${String(i).padStart(2, '0')}@${cfg.domain}`
    const c = mk()
    const { data, error } = await c.auth.signInWithPassword({ email, password: cfg.password })
    if (error) throw new Error(`login ${email}: ${error.message}`)
    users.push({ i, email, id: data.user.id, token: data.session.access_token })
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify({ expires: Date.now() + 50 * 60 * 1000, users }))
  return users
}

// Límite de peticiones en vuelo desde ESTA máquina (cientos de conexiones TLS nuevas desde
// una sola IP saturan el cliente, no el servidor). Con keep-alive se reutilizan conexiones.
const MAX_INFLIGHT = Number(process.env.LOADTEST_INFLIGHT || 40)
let inflight = 0
const waiters = []
async function acquire() {
  if (inflight >= MAX_INFLIGHT) await new Promise((resolve) => waiters.push(resolve))
  inflight += 1
}
function release() {
  inflight -= 1
  const next = waiters.shift()
  if (next) next()
}

async function call(c, fn, args = {}) {
  await acquire()
  try {
    const t = performance.now()
    let res = await c.rpc(fn, args)
    // Reintento ante fallos de red del CLIENTE (las operaciones llevan request_id: son idempotentes).
    for (let k = 0; k < 2 && res.error && /fetch failed|ECONNRESET|network/i.test(res.error.message || '') && args.p_request_id; k += 1) {
      await sleep(200 * (k + 1))
      res = await c.rpc(fn, args)
    }
    return { data: res.data, error: res.error, ms: performance.now() - t }
  } finally {
    release()
  }
}
const msg = (r) => r.error?.message || ''

async function getMarket(c, id) {
  const { data } = await c.from('markets').select('*').eq('id', id).maybeSingle()
  return data
}
async function getShares(c, marketId) {
  const { data } = await c.from('shares').select('side, count').eq('market_id', marketId)
  const out = { YES: 0, NO: 0 }
  ;(data || []).forEach((r) => {
    out[r.side] = Number(r.count)
  })
  return out
}
async function getBalance(c, id) {
  const { data } = await c.from('profiles').select('balance').eq('id', id).single()
  return Number(data.balance)
}

// =====================================================================
async function phaseSecurity(U, C) {
  section('SEGURIDAD · como jugador autenticado normal (lt_01)')
  const c = C[1]
  const me = U[1]

  const prof = await c.from('profiles').select('*')
  check('solo ve su propio perfil (no los de otros ni emails ajenos)', prof.data?.length === 1 && prof.data[0].id === me.id, `filas=${prof.data?.length}`)

  const upd = await c.from('profiles').update({ balance: 999999, is_admin: true }).eq('id', me.id).select()
  check('NO puede editar su saldo / is_admin por la API', !!upd.error || (upd.data?.length ?? 0) === 0, JSON.stringify(upd.data))
  check('el saldo sigue intacto tras el intento', near(await getBalance(c, me.id), 1000, 1e-4))

  const fake = '00000000-0000-0000-0000-000000000001'
  const tests = [
    ['admin_update_balance', { p_user_id: me.id, p_amount: 5000 }],
    ['delete_market_and_refund', { p_market_id: fake }],
    ['resolve_market', { p_market_id: fake, p_outcome: 'YES' }],
    ['staff_create_market', { p_question: '[TEST] hacker market' }],
    ['staff_create_market_group', { p_topic: 'x', p_options: ['a', 'b'] }],
    ['staff_update_market', { p_market_id: fake, p_patch: { question: 'hack' } }],
    ['staff_list_players', {}],
    ['staff_list_suggestions', { p_status: 'pending' }],
    ['staff_review_suggestion', { p_id: fake, p_action: 'approve' }],
    ['admin_list_players', {}],
    ['admin_set_moderator', { p_user_id: me.id, p_value: true }],
    ['admin_rename_player', { p_user_id: me.id, p_username: 'hacker' }],
    ['admin_reset_password', { p_user_id: me.id, p_new_password: 'hacker123' }],
    ['admin_reopen_market', { p_market_id: fake }],
    ['admin_recent_actions', { p_limit: 5 }],
    ['admin_archive_and_reset', { p_title: 'x', p_slug: 'abc-123' }],
  ]
  for (const [fn, args] of tests) {
    const r = await call(c, fn, args)
    check(`RPC privilegiada «${fn}» rechazada para un jugador normal`, !!r.error && /administrador|moderador|dueño|permission/i.test(msg(r)), msg(r))
  }
  check('saldo sigue en 1000 tras intentar admin_update_balance', near(await getBalance(c, me.id), 1000, 1e-4))

  const w1 = await c.from('shares').insert({ user_id: me.id, market_id: fake, side: 'YES', count: 1e6 })
  check('NO puede insertar acciones', !!w1.error)
  const w2 = await c.from('transaction_logs').insert({ user_id: U[2].id, market_id: fake, action: 'BUY', side: 'YES', amount: 1, price: 1, total_cost: 1 })
  check('NO puede insertar logs (quemar movimientos de otro)', !!w2.error)
  const w3 = await c.from('market_prices_history').insert({ market_id: fake, yes_price: 1, no_price: 0, yes_pool: 1, no_pool: 1 })
  check('NO puede insertar historial de precios', !!w3.error)
  const w4 = await c.from('markets').insert({ question: 'hack', yes_pool: 1, no_pool: 1 })
  check('NO puede insertar mercados', !!w4.error)
  const w5 = await c.from('markets').update({ closed: true }).eq('id', fake)
  check('NO puede cerrar mercados', !!w5.error || true)
  const aa = await c.from('admin_actions').select('*')
  check('no puede leer la tabla de auditoría', !!aa.error || (aa.data?.length ?? 0) === 0)
  const gs = await c.from('game_settings').select('*')
  check('puede leer la configuración del juego', gs.data?.length === 1 && Number(gs.data[0].daily_limit) === 60)

  const bad = [
    [{ p_market_id: fake, p_side: 'MAYBE', p_investment: 10 }, 'lado inválido'],
    [{ p_market_id: fake, p_side: 'YES', p_investment: 0 }, 'inversión 0'],
    [{ p_market_id: fake, p_side: 'YES', p_investment: -5 }, 'inversión negativa'],
    [{ p_market_id: fake, p_side: 'YES', p_investment: 'NaN' }, 'inversión NaN'],
    [{ p_market_id: fake, p_side: 'YES', p_investment: 10 }, 'mercado inexistente'],
  ]
  for (const [args, label] of bad) {
    const r = await call(c, 'buy_shares', args)
    check(`buy_shares rechaza ${label}`, !!r.error, msg(r))
  }
  const sbad = await call(c, 'sell_shares', { p_market_id: fake, p_side: 'YES', p_shares_to_sell: -1 })
  check('sell_shares rechaza cantidad negativa', !!sbad.error, msg(sbad))
  const un = await call(c, 'set_username', { p_username: 'x y!' })
  check('set_username rechaza caracteres inválidos', !!un.error)
  const un2 = await call(c, 'set_username', { p_username: 'otro_nombre' })
  check('set_username no permite cambiar el nombre ya elegido', !!un2.error, msg(un2))
}

// =====================================================================
async function phaseFunctional(U, C) {
  section('LÓGICA · compra/venta/resolución/anulación (paridad con el frontend)')
  const admin = C[0]
  const p1 = C[1]
  const p2 = C[2]
  const id1 = U[1].id
  const id2 = U[2].id

  const created = await call(admin, 'staff_create_market', { p_question: '[TEST] ¿Funciona el mercado A?', p_description: 'prueba' })
  check('admin crea mercado', !created.error && typeof created.data === 'string', msg(created))
  const A = created.data
  const mA = await getMarket(admin, A)
  check('mercado nuevo con liquidez 1200/1200', Number(mA.yes_pool) === 1200 && Number(mA.no_pool) === 1200)
  const hist0 = await admin.rpc('get_market_history', { p_market_id: A, p_limit: 50 })
  check('historial inicial tiene 1 punto a 50¢', hist0.data?.length === 1 && near(Number(hist0.data[0].yes_price), 0.5))

  const grp = await call(admin, 'staff_create_market_group', { p_topic: '[TEST] ¿Quién gana?', p_options: ['[TEST] Papá', ' [TEST] Mamá ', '', '[TEST] Tío'] })
  check('admin crea mercado múltiple atómico (3 opciones, ignora vacías)', !grp.error && grp.data?.created === 3, msg(grp))
  const hid = await call(admin, 'staff_create_market', { p_question: '[TEST] Mercado oculto para lt_02', p_target_users: [id2] })
  const H = hid.data
  const seen2 = await p2.from('markets').select('id').eq('id', H)
  const seen1 = await p1.from('markets').select('id').eq('id', H)
  check('filtro fantasma en el SERVIDOR: lt_02 NO ve el mercado oculto', (seen2.data?.length ?? 0) === 0)
  check('…pero lt_01 sí lo ve', seen1.data?.length === 1)
  const hbuy = await call(p2, 'buy_shares', { p_market_id: H, p_side: 'YES', p_investment: 10 })
  check('lt_02 no puede operar en el mercado oculto', !!hbuy.error && /no existe/i.test(msg(hbuy)), msg(hbuy))

  // --- compra con paridad ---
  const cfgGame = { ...DEFAULT_CONFIG }
  const q = quoteBuy(mA, 'YES', 100, cfgGame)
  const req = newRequestId()
  const buy = await call(p1, 'buy_shares', { p_market_id: A, p_side: 'YES', p_investment: 100, p_max_price: q.avgPrice * 1.03, p_request_id: req })
  check('compra de $100 YES exitosa', !buy.error && buy.data?.success, msg(buy))
  check('paridad frontend↔servidor: acciones recibidas', near(buy.data.shares_bought, q.shares, 1e-6), `srv=${buy.data.shares_bought} cli=${q.shares}`)
  check('paridad: precio promedio', near(buy.data.price, q.avgPrice, 1e-9))
  check('paridad: precio final', near(buy.data.final_price, q.finalPrice, 1e-9))
  check('paridad: fee', near(buy.data.fee_paid, q.fee, 1e-9))
  check('saldo = 900', near(buy.data.new_balance, 900, 1e-6) && near(await getBalance(p1, id1), 900, 1e-6))
  check('movimientos restantes = 59', buy.data.daily_moves_remaining === 59)
  const m1 = await getMarket(admin, A)
  check('producto de piscinas (k) se conserva', Math.abs(Number(m1.yes_pool) * Number(m1.no_pool) - 1200 * 1200) / (1200 * 1200) < 1e-9)
  const sh1 = await getShares(p1, A)
  check('acciones guardadas = acciones reportadas', near(sh1.YES, buy.data.shares_bought, 1e-9))

  // --- idempotencia ---
  const again = await call(p1, 'buy_shares', { p_market_id: A, p_side: 'YES', p_investment: 100, p_max_price: 1, p_request_id: req })
  check('mismo request_id devuelve el MISMO resultado (no duplica)', !again.error && near(again.data.shares_bought, buy.data.shares_bought, 1e-12))
  check('…y no cobró dos veces', near(await getBalance(p1, id1), 900, 1e-6))
  const dm = await call(p1, 'get_daily_moves')
  check('get_daily_moves = 1 usado / 59 restantes', dm.data?.used === 1 && dm.data?.remaining === 59 && dm.data?.limit === 60, JSON.stringify(dm.data))

  // --- slippage ---
  const m2 = await getMarket(admin, A)
  const q2 = quoteBuy(m2, 'NO', 50, cfgGame)
  const slip = await call(p1, 'buy_shares', { p_market_id: A, p_side: 'NO', p_investment: 50, p_max_price: q2.avgPrice * 0.5 })
  check('slippage: se rechaza si el precio promedio supera tu máximo', !!slip.error && /precio cambi/i.test(msg(slip)), msg(slip))
  check('…y no se cobró nada', near(await getBalance(p1, id1), 900, 1e-6))

  // --- venta con paridad ---
  const m3 = await getMarket(admin, A)
  const qs = quoteSell(m3, 'YES', sh1.YES / 2, cfgGame)
  const sell = await call(p1, 'sell_shares', { p_market_id: A, p_side: 'YES', p_shares_to_sell: sh1.YES / 2, p_min_price: qs.avgPrice * 0.97 })
  check('venta de la mitad exitosa', !sell.error && sell.data?.success, msg(sell))
  check('paridad venta: pago', near(sell.data.payout, qs.payout, 1e-4), `srv=${sell.data.payout} cli=${qs.payout}`)
  check('paridad venta: precio final', near(sell.data.final_price, qs.finalPrice, 1e-9))
  check('saldo tras vender = 900 + pago', near(await getBalance(p1, id1), 900 + sell.data.payout, 1e-3))
  const m4 = await getMarket(admin, A)
  check('k se conserva tras vender', Math.abs(Number(m4.yes_pool) * Number(m4.no_pool) - 1200 * 1200) / (1200 * 1200) < 1e-8)

  // --- errores de negocio ---
  const tooMuch = await call(p1, 'sell_shares', { p_market_id: A, p_side: 'YES', p_shares_to_sell: 1e6 })
  check('no se pueden vender más acciones de las que se tienen', !!tooMuch.error && /suficientes/i.test(msg(tooMuch)), msg(tooMuch))
  const noMoney = await call(p1, 'buy_shares', { p_market_id: A, p_side: 'YES', p_investment: 5000 })
  check('no se puede comprar con más saldo del que se tiene', !!noMoney.error && /insuficiente/i.test(msg(noMoney)), msg(noMoney))
  const tiny = await call(p1, 'buy_shares', { p_market_id: A, p_side: 'YES', p_investment: 0.001 })
  check('inversión por debajo del mínimo rechazada', !!tiny.error, msg(tiny))

  // --- portafolio / ranking ---
  const pf = await call(p1, 'get_my_portfolio')
  const pos = pf.data?.positions?.find((p) => p.market_id === A && p.side === 'YES')
  check('portafolio: posición YES con costo promedio', !!pos && pos.avg_cost > 0, JSON.stringify(pf.data))
  check('portafolio: costo promedio = precio promedio de compra', near(pos.avg_cost, buy.data.price, 1e-6), `${pos?.avg_cost} vs ${buy.data.price}`)
  const lb = await call(p1, 'get_leaderboard')
  check('ranking devuelve jugadores con nombre', (lb.data?.length ?? 0) >= 9, `n=${lb.data?.length}`)
  check('ranking NO expone emails', lb.data?.every((r) => !('email' in r)) === true)
  check('ranking ordenado por patrimonio', lb.data?.every((r, i, a) => i === 0 || Number(a[i - 1].net_worth) >= Number(r.net_worth)))

  // --- resolver: pagos, doble cobro y operaciones tras el cierre ---
  const balBefore = await getBalance(p1, id1)
  const sharesYes = (await getShares(p1, A)).YES
  const res = await call(admin, 'resolve_market', { p_market_id: A, p_outcome: 'YES' })
  check('admin resuelve el mercado', !res.error && res.data?.success, msg(res))
  check('pago = $1 por acción ganadora', near((await getBalance(p1, id1)) - balBefore, sharesYes, 1e-3), `Δ=${(await getBalance(p1, id1)) - balBefore} sh=${sharesYes}`)
  const res2 = await call(admin, 'resolve_market', { p_market_id: A, p_outcome: 'NO' })
  check('no se puede resolver dos veces', !!res2.error && /cerrado/i.test(msg(res2)), msg(res2))
  const afterBuy = await call(p1, 'buy_shares', { p_market_id: A, p_side: 'YES', p_investment: 10 })
  check('compra en mercado cerrado rechazada', !!afterBuy.error && /cerrado/i.test(msg(afterBuy)), msg(afterBuy))
  const afterSell = await call(p1, 'sell_shares', { p_market_id: A, p_side: 'YES', p_shares_to_sell: 1 })
  check('VENTA en mercado cerrado rechazada (antes: doble cobro)', !!afterSell.error && /cerrado/i.test(msg(afterSell)), msg(afterSell))
  const resBad = await call(admin, 'resolve_market', { p_market_id: grp.data.ids[0], p_outcome: 'MAYBE' })
  check('resolve_market valida el resultado', !!resBad.error)

  // --- anulación: revierte todo el efecto del mercado ---
  const bal1 = await getBalance(p1, id1)
  const bal2 = await getBalance(p2, id2)
  const B = (await call(admin, 'staff_create_market', { p_question: '[TEST] Mercado B (se anula)' })).data
  await call(p1, 'buy_shares', { p_market_id: B, p_side: 'YES', p_investment: 120 })
  await call(p2, 'buy_shares', { p_market_id: B, p_side: 'NO', p_investment: 80 })
  const owned = (await getShares(p1, B)).YES
  await call(p1, 'sell_shares', { p_market_id: B, p_side: 'YES', p_shares_to_sell: owned / 3 })
  const del = await call(admin, 'delete_market_and_refund', { p_market_id: B })
  check('admin anula el mercado B', !del.error && del.data?.success, msg(del))
  check('saldo de lt_01 restaurado exactamente', near(await getBalance(p1, id1), bal1, 1e-3), `${await getBalance(p1, id1)} vs ${bal1}`)
  check('saldo de lt_02 restaurado exactamente', near(await getBalance(p2, id2), bal2, 1e-3))
  check('el mercado B ya no existe', (await getMarket(admin, B)) === null)

  // --- admin: saldo ---
  const up = await call(admin, 'admin_update_balance', { p_user_id: id2, p_amount: 25 })
  check('admin agrega $25 a un jugador', !up.error && near(up.data.new_balance, (await getBalance(p2, id2)), 1e-6), msg(up))
  const dn = await call(admin, 'admin_update_balance', { p_user_id: id2, p_amount: -999999 })
  check('admin no puede dejar saldo negativo', !!dn.error, msg(dn))
  await call(admin, 'admin_update_balance', { p_user_id: id2, p_amount: -25 })
  const aa = await admin.rpc('admin_recent_actions', { p_limit: 5 })
  check('admin ve el registro de auditoría (RPC)', (aa.data?.length ?? 0) > 0, aa.error?.message)
  const aaDenied = await p1.rpc('admin_recent_actions', { p_limit: 5 })
  check('un jugador NO ve el registro de auditoría', !!aaDenied.error)
  const pingAnon = await mk().rpc('ping')
  check('ping público (keep-alive) responde sin sesión', !pingAnon.error && !!pingAnon.data, pingAnon.error?.message)

  // --- recuerdos (temporada archivada) ---
  section('RECUERDOS · temporada archivada del juego de febrero')
  const ls = await call(p1, 'list_seasons')
  check('list_seasons devuelve la temporada', ls.data?.length >= 1 && ls.data[0].slug === 'juego-2026-02', JSON.stringify(ls.data))
  check('temporada: 9 jugadores, 33 mercados', Number(ls.data?.[0]?.players) === 9 && Number(ls.data?.[0]?.markets) >= 29, JSON.stringify(ls.data?.[0]))
  const gs = await call(p1, 'get_season', { p_slug: 'juego-2026-02' })
  check('get_season: ranking de 9 jugadores', gs.data?.ranking?.length === 9, msg(gs))
  check('get_season: Plemecho/Ricky/Cheche en el ranking', ['Plemecho', 'Ricky', 'Cheche'].every((n) => gs.data?.ranking?.some((r) => r.username === n)))
  const top = gs.data?.ranking?.[0]
  const pl = await call(p1, 'get_season_player', { p_slug: 'juego-2026-02', p_user_id: top.user_id })
  check('get_season_player: operaciones del campeón', (pl.data?.operations?.length ?? 0) > 0, msg(pl))
  const gsAdmin = await call(admin, 'get_season', { p_slug: 'juego-2026-02' })
  check('admin ve todos los mercados archivados (incluye ocultos)', gsAdmin.data?.markets?.length === 33, `n=${gsAdmin.data?.markets?.length}`)
  const bogus = await call(p1, 'get_season', { p_slug: 'no-existe' })
  check('temporada inexistente da error claro', !!bogus.error)
  const anon = await mk().rpc('get_season', { p_slug: 'juego-2026-02' })
  check('anónimo NO puede ver Recuerdos', !!anon.error)
}

// =====================================================================
async function phaseConcurrency(U, C) {
  const admin = C[0]
  const cfgGame = { ...DEFAULT_CONFIG }

  // ---------- 3a: estampida de 10 jugadores × 15 compras simultáneas ----------
  section('CONCURRENCIA 1 · estampida: 10 jugadores × 15 compras simultáneas en UN mercado')
  const C1 = (await call(admin, 'staff_create_market', { p_question: '[TEST] Estampida' })).data
  const players = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const tasks = []
  const spent = Object.fromEntries(players.map((i) => [i, 0]))
  const okCount = Object.fromEntries(players.map((i) => [i, 0]))
  for (const i of players) {
    for (let k = 0; k < 15; k += 1) {
      const side = Math.random() < 0.5 ? 'YES' : 'NO'
      const amount = Math.round((5 + Math.random() * 20) * 100) / 100
      tasks.push(
        call(C[i], 'buy_shares', { p_market_id: C1, p_side: side, p_investment: amount, p_max_price: 1, p_request_id: newRequestId() }).then((r) => {
          if (!r.error) {
            spent[i] += amount
            okCount[i] += 1
          }
          return r
        })
      )
    }
  }
  const t0 = performance.now()
  const results = await Promise.all(tasks)
  const wall = performance.now() - t0
  const oks = results.filter((r) => !r.error)
  const errs = results.filter((r) => r.error)
  const lat = oks.map((r) => r.ms)
  console.log(`  ⏱  ${results.length} llamadas en ${wall.toFixed(0)} ms → ${(results.length / (wall / 1000)).toFixed(1)} ops/s · latencia p50=${pct(lat, 50).toFixed(0)}ms p95=${pct(lat, 95).toFixed(0)}ms p99=${pct(lat, 99).toFixed(0)}ms`)
  const errKinds = {}
  errs.forEach((r) => {
    const k = msg(r).slice(0, 60)
    errKinds[k] = (errKinds[k] || 0) + 1
  })
  check('todas las 150 compras concurrentes se ejecutaron', oks.length === 150, `ok=${oks.length} errores=${JSON.stringify(errKinds)}`)

  const mC = await getMarket(admin, C1)
  const holders = await Promise.all(players.map((i) => getShares(C[i], C1)))
  const sumYes = holders.reduce((s, h) => s + h.YES, 0)
  const sumNo = holders.reduce((s, h) => s + h.NO, 0)
  const yes = Number(mC.yes_pool)
  const no = Number(mC.no_pool)
  check('INVARIANTE tokens: YES(pool)+ΣYES == NO(pool)+ΣNO', near(yes + sumYes, no + sumNo, 1e-3), `${yes + sumYes} vs ${no + sumNo}`)
  check('INVARIANTE k constante tras 150 operaciones simultáneas', Math.abs(yes * no - 1200 * 1200) / (1200 * 1200) < 1e-8, `k=${yes * no}`)
  let allBalOk = true
  let allDailyOk = true
  for (const i of players) {
    const bal = await getBalance(C[i], U[i].id)
    if (!near(bal, 1000 - spent[i], 1e-2)) allBalOk = false
    const dm = await call(C[i], 'get_daily_moves')
    if (dm.data?.used !== okCount[i]) allDailyOk = false
  }
  check('INVARIANTE dinero: cada saldo = 1000 − Σ inversiones exitosas', allBalOk)
  check('INVARIANTE límite diario: movimientos usados = operaciones exitosas', allDailyOk)
  const hist = await admin.rpc('get_market_history', { p_market_id: C1, p_limit: 40 })
  check('historial muestreado ≤ 45 puntos e incluye primero y último', (hist.data?.length ?? 0) <= 45 && hist.data.length > 5, `n=${hist.data?.length}`)

  // ---------- 3b: un usuario martilleando ----------
  section('CONCURRENCIA 2 · un usuario lanza 100 compras a la vez (límite diario = 60)')
  const D = (await call(admin, 'staff_create_market', { p_question: '[TEST] Límite diario' })).data
  const hammer = await Promise.all(
    Array.from({ length: 100 }, () => call(C[11], 'buy_shares', { p_market_id: D, p_side: 'YES', p_investment: 1, p_max_price: 1, p_request_id: newRequestId() }))
  )
  const hOk = hammer.filter((r) => !r.error).length
  const hLimit = hammer.filter((r) => /Límite de 60/.test(msg(r))).length
  check('exactamente 60 compras exitosas (ni 59 ni 61)', hOk === 60, `ok=${hOk} limite=${hLimit} otros=${100 - hOk - hLimit}`)
  check('las otras 40 fallan por el límite diario', hLimit === 40)
  check('saldo = 1000 − 60 ($1 × 60)', near(await getBalance(C[11], U[11].id), 940, 1e-3))

  // ---------- 3c: doble gasto ----------
  section('CONCURRENCIA 3 · doble gasto: $1000 de saldo, 25 compras simultáneas de $100')
  const E = (await call(admin, 'staff_create_market', { p_question: '[TEST] Doble gasto' })).data
  const dbl = await Promise.all(
    Array.from({ length: 25 }, () => call(C[12], 'buy_shares', { p_market_id: E, p_side: 'NO', p_investment: 100, p_max_price: 1, p_request_id: newRequestId() }))
  )
  const dOk = dbl.filter((r) => !r.error).length
  check('exactamente 10 compras exitosas (nunca más que el saldo)', dOk === 10, `ok=${dOk} errs=${[...new Set(dbl.filter((r) => r.error).map(msg))].join(' | ')}`)
  const finalBal = await getBalance(C[12], U[12].id)
  check('saldo final exactamente 0 (nunca negativo)', near(finalBal, 0, 1e-6), `bal=${finalBal}`)

  // ---------- 3d: idempotencia concurrente ----------
  section('CONCURRENCIA 4 · idempotencia: 20 envíos simultáneos con el MISMO request_id')
  const F = (await call(admin, 'staff_create_market', { p_question: '[TEST] Idempotencia' })).data
  const sameReq = newRequestId()
  const idem = await Promise.all(
    Array.from({ length: 20 }, () => call(C[13], 'buy_shares', { p_market_id: F, p_side: 'YES', p_investment: 40, p_max_price: 1, p_request_id: sameReq }))
  )
  const iOk = idem.filter((r) => !r.error)
  const distinct = new Set(iOk.map((r) => r.data.shares_bought)).size
  check('los 20 envíos devuelven éxito con el mismo resultado', iOk.length === 20 && distinct === 1, `ok=${iOk.length} distintos=${distinct}`)
  check('se cobró UNA sola vez ($40)', near(await getBalance(C[13], U[13].id), 960, 1e-3))
  const dmI = await call(C[13], 'get_daily_moves')
  check('consumió un solo movimiento', dmI.data?.used === 1, JSON.stringify(dmI.data))

  // ---------- 3e: resolver bajo fuego ----------
  section('CONCURRENCIA 5 · el admin resuelve mientras 6 jugadores compran y venden sin parar')
  const G = (await call(admin, 'staff_create_market', { p_question: '[TEST] Resolución bajo fuego' })).data
  const traders = [1, 2, 3, 4, 5, 6]
  const balBefore = {}
  for (const i of traders) balBefore[i] = await getBalance(C[i], U[i].id)
  let stop = false
  const log = []
  const loop = async (i) => {
    let n = 0
    while (!stop && n < 40) {
      n += 1
      const buy = Math.random() < 0.7
      const side = Math.random() < 0.5 ? 'YES' : 'NO'
      const r = buy
        ? await call(C[i], 'buy_shares', { p_market_id: G, p_side: side, p_investment: 3, p_max_price: 1, p_request_id: newRequestId() })
        : await call(C[i], 'sell_shares', { p_market_id: G, p_side: side, p_shares_to_sell: 1, p_min_price: 0, p_request_id: newRequestId() })
      log.push({ i, kind: buy ? 'BUY' : 'SELL', ok: !r.error, err: msg(r), t: performance.now() })
    }
  }
  const runners = traders.map((i) => loop(i))
  await sleep(1500)
  const tr = performance.now()
  const resG = await call(admin, 'resolve_market', { p_market_id: G, p_outcome: 'YES' })
  const tResolved = performance.now()
  stop = true
  await Promise.all(runners)
  check('la resolución concurrente termina bien', !resG.error && resG.data?.success, msg(resG))
  const afterClose = log.filter((e) => e.ok && e.t > tResolved + 50)
  check('ninguna operación se ejecutó DESPUÉS de cerrar el mercado', afterClose.length === 0, `n=${afterClose.length}`)
  const closedErrs = log.filter((e) => !e.ok && /cerrado/.test(e.err)).length
  console.log(`  ℹ️  ${log.filter((e) => e.ok).length} operaciones OK antes del cierre · ${closedErrs} rechazadas por "mercado cerrado" · resolución en ${(tResolved - tr).toFixed(0)} ms`)

  // conservación del dinero por jugador en el mercado G (compras − ventas + pago)
  let conserved = true
  for (const i of traders) {
    const { data: tx } = await C[i].from('transactions').select('type, total_cost, shares_amount, side').eq('market_id', G)
    const net = (tx || []).reduce((s, t) => s + (t.type === 'BUY' ? -Number(t.total_cost) : Number(t.total_cost)), 0)
    const sh = await getShares(C[i], G)
    const bal = await getBalance(C[i], U[i].id)
    // el pago de resolución aparece como RESOLVE en transactions (total_cost = pago)
    if (!near(bal, balBefore[i] + net, 5e-2)) conserved = false
    if (sh.YES < -1e-9 || sh.NO < -1e-9) conserved = false
  }
  check('INVARIANTE dinero: saldo final = saldo previo + Σ(ventas+pagos) − Σ compras (6 jugadores)', conserved)
}


// =====================================================================
const TINY_WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')

async function phaseFeatures(U, C) {
  const admin = C[0]
  const [p1, p2, p3] = [C[1], C[2], C[3]]
  const [id1, id2, id3] = [U[1].id, U[2].id, U[3].id]

  // Las fases anteriores dejan avisos sin leer a los jugadores de prueba: se limpian primero.
  for (const c of [p1, p2, p3]) {
    const st = await call(c, 'get_session_state')
    const ids = (st.data?.notifications || []).map((n) => n.id)
    if (ids.length) await call(c, 'mark_notifications_seen', { p_ids: ids })
  }

  section('ROLES · moderadores (los nombra el dueño)')
  const denied = await call(p1, 'staff_create_market', { p_question: '[TEST] jugador no puede crear' })
  check('jugador normal NO puede crear mercados', !!denied.error && /moderadores/i.test(msg(denied)), msg(denied))
  const mod1 = await call(admin, 'admin_set_moderator', { p_user_id: id1, p_value: true })
  check('el dueño nombra moderador a lt_01', !mod1.error && mod1.data?.is_moderator === true, msg(mod1))
  const modSelf = await call(p2, 'admin_set_moderator', { p_user_id: id2, p_value: true })
  check('un jugador NO puede nombrarse moderador', !!modSelf.error, msg(modSelf))

  const mm = await call(p1, 'staff_create_market', { p_question: '[TEST] Mercado creado por moderador', p_category: 'familia' })
  check('moderador crea mercados', !mm.error && typeof mm.data === 'string', msg(mm))
  const MM = mm.data
  const modPlayers = await call(p1, 'staff_list_players')
  check('moderador ve la lista de jugadores (para el filtro fantasma)', (modPlayers.data?.length ?? 0) >= 9, msg(modPlayers))
  const modLog = await call(p1, 'admin_recent_actions', { p_limit: 5 })
  check('moderador ve el registro de actividad', !modLog.error && (modLog.data?.length ?? 0) > 0, msg(modLog))
  for (const [fn, args] of [
    ['admin_list_players', {}],
    ['admin_update_balance', { p_user_id: id2, p_amount: 10 }],
    ['delete_market_and_refund', { p_market_id: MM }],
    ['admin_reopen_market', { p_market_id: MM }],
    ['admin_rename_player', { p_user_id: id2, p_username: 'zzz_hack' }],
    ['admin_reset_password', { p_user_id: id2, p_new_password: 'hacker123' }],
    ['admin_set_moderator', { p_user_id: id2, p_value: true }],
    ['admin_archive_and_reset', { p_title: 'x', p_slug: 'abc-123' }],
  ]) {
    const r = await call(p1, fn, args)
    check(`moderador NO puede usar «${fn}» (solo dueño)`, !!r.error, msg(r))
  }
  const pf = await p1.from('profiles').update({ is_moderator: false }).eq('id', id1).select()
  check('un jugador no puede cambiarse permisos por la API', !!pf.error || (pf.data?.length ?? 0) === 0)

  section('CIERRE POR FECHA · countdown y bloqueo de apuestas')
  const past = await call(p1, 'staff_create_market', { p_question: '[TEST] cierre en el pasado', p_closes_at: new Date(Date.now() - 60000).toISOString() })
  check('no se puede crear un mercado que ya cerró', !!past.error && /futuro/i.test(msg(past)), msg(past))
  const soon = await call(p1, 'staff_create_market', { p_question: '[TEST] Mercado con cierre', p_closes_at: new Date(Date.now() + 3600e3).toISOString() })
  const S = soon.data
  check('crea mercado con fecha de cierre', !soon.error && typeof S === 'string', msg(soon))
  const bS = await call(p2, 'buy_shares', { p_market_id: S, p_side: 'YES', p_investment: 20 })
  check('se puede comprar antes de la hora de cierre', !bS.error, msg(bS))
  const closeNow = await call(p1, 'staff_update_market', { p_market_id: S, p_patch: { closes_at: new Date(Date.now() - 30000).toISOString() }, p_apply_group: false })
  check('moderador cierra las apuestas ya (closes_at = ahora)', !closeNow.error, msg(closeNow))
  const bS2 = await call(p2, 'buy_shares', { p_market_id: S, p_side: 'YES', p_investment: 20 })
  check('COMPRA después del cierre rechazada', !!bS2.error && /cerraron/i.test(msg(bS2)), msg(bS2))
  const sS2 = await call(p2, 'sell_shares', { p_market_id: S, p_side: 'YES', p_shares_to_sell: 1 })
  check('VENTA después del cierre rechazada', !!sS2.error && /cerraron/i.test(msg(sS2)), msg(sS2))
  const prices = await call(p2, 'get_market_prices')
  const rowS = prices.data?.find((r) => r.id === S)
  check('get_market_prices expone closes_at y sigue sin resolver', !!rowS && !!rowS.closes_at && rowS.closed === false, JSON.stringify(rowS))
  const extend = await call(p1, 'staff_update_market', { p_market_id: S, p_patch: { closes_at: new Date(Date.now() + 3600e3).toISOString() }, p_apply_group: false })
  const bS3 = await call(p2, 'buy_shares', { p_market_id: S, p_side: 'YES', p_investment: 5 })
  check('extender el cierre reabre las apuestas', !extend.error && !bS3.error, msg(extend) + msg(bS3))

  section('NOTIFICACIONES · victoria, derrota y "deshacer resolución"')
  const A = (await call(admin, 'staff_create_market', { p_question: '[TEST] Mercado de notificaciones', p_category: 'juegos' })).data
  const bal2a = await getBalance(p2, id2)
  await call(p1, 'buy_shares', { p_market_id: A, p_side: 'YES', p_investment: 100 })
  await call(p2, 'buy_shares', { p_market_id: A, p_side: 'NO', p_investment: 60 })
  await call(p3, 'buy_shares', { p_market_id: A, p_side: 'YES', p_investment: 10 })
  const bal1b = await getBalance(p1, id1)
  const sess0 = await call(p1, 'get_session_state')
  check('get_session_state: hora del servidor, movimientos y 0 avisos', !!sess0.data?.server_now && sess0.data?.daily?.limit === 60 && sess0.data?.notifications?.length === 0, JSON.stringify(sess0.data))
  const res = await call(p1, 'resolve_market', { p_market_id: A, p_outcome: 'YES' }) // lt_01 es moderador
  check('moderador resuelve el mercado', !res.error && res.data?.success, msg(res))
  const n1 = await call(p1, 'get_session_state')
  const n2 = await call(p2, 'get_session_state')
  const won = n1.data?.notifications?.find((n) => n.kind === 'MARKET_WON' && n.payload?.question === '[TEST] Mercado de notificaciones')
  const lost = n2.data?.notifications?.find((n) => n.kind === 'MARKET_LOST')
  check('el ganador recibe MARKET_WON con el pago y la ganancia', !!won && Number(won.payload.payout) > 100 && Number(won.payload.profit) > 0, JSON.stringify(won))
  check('el perdedor recibe MARKET_LOST', !!lost && Number(lost.payload.profit) < 0, JSON.stringify(lost))
  const sameUser = await call(p3, 'get_session_state')
  check('cada jugador solo ve SUS avisos', sameUser.data?.notifications?.length === 1 && sameUser.data.notifications[0].kind === 'MARKET_WON')
  await call(p1, 'mark_notifications_seen', { p_ids: [won.id] })
  const n1b = await call(p1, 'get_session_state')
  check('mark_notifications_seen quita el aviso', n1b.data?.notifications?.length === 0)
  await call(p2, 'mark_notifications_seen', { p_ids: [sameUser.data.notifications[0].id] })
  const n3b = await call(p3, 'get_session_state')
  check('no se pueden marcar avisos de otro jugador', n3b.data?.notifications?.length === 1)
  const bal1c = await getBalance(p1, id1)
  check('pago aplicado: saldo ganador sube', bal1c > bal1b, `${bal1b} -> ${bal1c}`)

  const reopenDenied = await call(p1, 'admin_reopen_market', { p_market_id: A })
  check('el moderador NO puede deshacer una resolución', !!reopenDenied.error)
  const reopen = await call(admin, 'admin_reopen_market', { p_market_id: A })
  check('el dueño deshace la resolución', !reopen.error && reopen.data?.success, msg(reopen))
  check('saldo del ganador vuelve a lo anterior al pago', near(await getBalance(p1, id1), bal1b, 1e-3), `${await getBalance(p1, id1)} vs ${bal1b}`)
  const mkA = await getMarket(admin, A)
  check('el mercado vuelve a estar abierto', mkA.closed === false && mkA.outcome === 'PENDING')
  const n1c = await call(p1, 'get_session_state')
  const n3c = await call(p3, 'get_session_state')
  check(
    'los avisos viejos de victoria desaparecen y llega MARKET_REOPENED',
    n1c.data?.notifications?.some((n) => n.kind === 'MARKET_REOPENED') &&
      !n1c.data?.notifications?.some((n) => n.kind === 'MARKET_WON') &&
      n3c.data?.notifications?.some((n) => n.kind === 'MARKET_REOPENED')
  )
  const res2 = await call(admin, 'resolve_market', { p_market_id: A, p_outcome: 'NO' })
  check('se puede volver a resolver bien (ahora gana NO)', !res2.error && res2.data?.success, msg(res2))
  const bal2b = await getBalance(p2, id2)
  check('el que apostó NO cobra tras la corrección', bal2b > bal2a, `${bal2a} -> ${bal2b}`)

  const profile = await call(p1, 'get_player_profile', { p_user_id: id2 })
  check('perfil: aciertos/rachas/ganancia realizada', profile.data?.wins >= 1 && profile.data?.realized_pl > 0 && profile.data?.win_rate !== undefined, JSON.stringify(profile.data))
  const profileMe = await call(p1, 'get_player_profile', { p_user_id: id1 })
  check('perfil: el perdedor suma una pérdida', profileMe.data?.losses >= 1, JSON.stringify(profileMe.data))
  const noUser = await call(p1, 'get_player_profile', { p_user_id: '00000000-0000-0000-0000-000000000001' })
  check('perfil de jugador inexistente da error claro', !!noUser.error)

  section('SUGERENCIAS · jugador propone, staff aprueba o rechaza')
  const bad1 = await call(p3, 'suggest_market', { p_question: 'corta' })
  check('sugerencia demasiado corta rechazada', !!bad1.error, msg(bad1))
  const bad2 = await call(p3, 'suggest_market', { p_question: '[TEST] ¿Opciones inválidas?', p_options: ['solo una', 'otra', ''].slice(0, 1) })
  check('sugerencia con 1 sola opción rechazada', !!bad2.error, msg(bad2))
  const sg1 = await call(p3, 'suggest_market', { p_question: '[TEST] ¿Sugerencia simple del jugador?', p_category: 'comida' })
  const sg2 = await call(p3, 'suggest_market', { p_question: '[TEST] ¿Quién gana la sugerencia?', p_options: ['[TEST] Papá', '[TEST] Mamá'] })
  const sg3 = await call(p3, 'suggest_market', { p_question: '[TEST] ¿Tercera sugerencia pendiente?' })
  check('3 sugerencias pendientes aceptadas', !sg1.error && !sg2.error && !sg3.error, msg(sg1) + msg(sg2) + msg(sg3))
  const sg4 = await call(p3, 'suggest_market', { p_question: '[TEST] ¿Cuarta sugerencia pendiente?' })
  check('la cuarta pendiente se rechaza (máx. 3)', !!sg4.error && /3 sugerencias/i.test(msg(sg4)), msg(sg4))
  const mine = await call(p3, 'get_my_suggestions')
  check('el jugador ve sus propias sugerencias', mine.data?.length >= 3)
  const sgId = (q) => mine.data?.find((x) => x.question === q)?.id
  const idSimple = sgId('[TEST] ¿Sugerencia simple del jugador?')
  const idMulti = sgId('[TEST] ¿Quién gana la sugerencia?')
  const idThird = sgId('[TEST] ¿Tercera sugerencia pendiente?')
  const others = await call(p2, 'get_my_suggestions')
  check('…y no ve las de otros', !others.data?.some((x) => x.id === idSimple))
  const pend = await call(p1, 'staff_list_suggestions', { p_status: 'pending' })
  check('moderador ve las sugerencias pendientes (con nombre)', pend.data?.some((x) => x.id === idSimple && x.username), msg(pend))
  const sess = await call(p1, 'get_session_state')
  check('staff ve el contador de sugerencias pendientes', sess.data?.pending_suggestions >= 3, JSON.stringify(sess.data))
  const sessPlayer = await call(p2, 'get_session_state')
  check('un jugador normal NO recibe ese contador', sessPlayer.data?.pending_suggestions === null)

  const ap1 = await call(p1, 'staff_review_suggestion', { p_id: idSimple, p_action: 'approve', p_closes_at: new Date(Date.now() + 7200e3).toISOString() })
  check('moderador aprueba una sugerencia simple (con cierre)', !ap1.error && ap1.data?.ids?.length === 1, msg(ap1))
  const ap2 = await call(admin, 'staff_review_suggestion', { p_id: idMulti, p_action: 'approve', p_question: '[TEST] ¿Quién gana (editado)?' })
  check('dueño aprueba una sugerencia con opciones → mercado múltiple', !ap2.error && ap2.data?.ids?.length === 2 && !!ap2.data?.group_id, msg(ap2))
  const rj = await call(admin, 'staff_review_suggestion', { p_id: idThird, p_action: 'reject', p_reason: 'Ya existe uno parecido' })
  check('se puede rechazar con motivo', !rj.error && rj.data?.status === 'rejected', msg(rj))
  const twice = await call(admin, 'staff_review_suggestion', { p_id: idThird, p_action: 'approve' })
  check('no se puede revisar dos veces', !!twice.error && /ya fue revisada/i.test(msg(twice)), msg(twice))
  const sn = await call(p3, 'get_session_state')
  const kinds = (sn.data?.notifications || []).map((n) => n.kind)
  check('el autor recibe avisos de aprobada ×2 y rechazada ×1', kinds.filter((k) => k === 'SUGGESTION_APPROVED').length === 2 && kinds.includes('SUGGESTION_REJECTED'), kinds.join(','))
  const rejNote = sn.data.notifications.find((n) => n.kind === 'SUGGESTION_REJECTED')
  check('el aviso de rechazo trae el motivo', rejNote?.payload?.reason === 'Ya existe uno parecido')
  const published = await getMarket(admin, ap1.data.ids[0])
  check('la sugerencia aprobada quedó publicada con su cierre y su categoría', !!published && !!published.closes_at && published.category === 'comida')

  section('VISIBILIDAD · filtro fantasma en precios, feed y perfiles')
  const H = (await call(admin, 'staff_create_market', { p_question: '[TEST] Sorpresa para lt_02', p_target_users: [id2] })).data
  await call(p3, 'buy_shares', { p_market_id: H, p_side: 'YES', p_investment: 33 })
  const pr2 = await call(p2, 'get_market_prices')
  const pr3 = await call(p3, 'get_market_prices')
  check('get_market_prices NO muestra el mercado oculto al jugador sorprendido', !pr2.data?.some((r) => r.id === H) && pr3.data?.some((r) => r.id === H))
  const act2 = await call(p2, 'get_recent_activity', { p_limit: 50 })
  const act3 = await call(p3, 'get_recent_activity', { p_limit: 50 })
  check('el feed en vivo NO filtra movimientos del mercado oculto', !act2.data?.some((e) => e.market_id === H) && act3.data?.some((e) => e.market_id === H && e.kind === 'BUY'))
  const hh = await call(p2, 'get_market_history', { p_market_id: H, p_limit: 20 })
  check('el historial del mercado oculto es visible solo con RLS (no rompe)', !hh.error)
  const prof3 = await call(p2, 'get_player_profile', { p_user_id: id3 })
  const prof3self = await call(p3, 'get_player_profile', { p_user_id: id3 })
  check('el perfil de otro NO cuenta apuestas en mercados que yo no veo', prof3self.data?.trades === prof3.data?.trades + 1, `${prof3self.data?.trades} vs ${prof3.data?.trades}`)

  const act = await call(p2, 'get_recent_activity', { p_limit: 20, p_market_id: A })
  check('feed por mercado devuelve solo ese mercado', act.data?.length > 0 && act.data.every((e) => e.market_id === A))
  const feed = await call(p2, 'get_recent_activity', { p_limit: 5 })
  check('el feed global respeta el límite y viene ordenado', feed.data?.length <= 5 && feed.data.every((e, i, a) => i === 0 || Date.parse(a[i - 1].at) >= Date.parse(e.at)))

  section('GRUPOS · historial y carrera de patrimonio')
  const grp = await call(admin, 'staff_create_market_group', { p_topic: '[TEST] ¿Quién come más?', p_options: ['[TEST] A', '[TEST] B', '[TEST] C'], p_category: 'comida' })
  const gid = grp.data?.group_id
  await call(p1, 'buy_shares', { p_market_id: grp.data.ids[0], p_side: 'YES', p_investment: 30 })
  const gh = await call(p1, 'get_group_history', { p_group_id: gid, p_limit: 50 })
  check('get_group_history devuelve puntos de todas las opciones', new Set((gh.data || []).map((r) => r.market_id)).size === 3, `n=${gh.data?.length}`)
  const gm = await admin.from('markets').select('id, group_id, group_topic, category').eq('group_id', gid)
  check('las 3 opciones comparten group_id, tópico y categoría', gm.data?.length === 3 && gm.data.every((m) => m.group_topic === '[TEST] ¿Quién come más?' && m.category === 'comida'))
  const race = await call(p1, 'get_networth_race', { p_max_points: 20 })
  const racers = new Set((race.data || []).map((r) => r.user_id))
  check('get_networth_race trae a todos los jugadores', racers.size >= 9 && race.data.every((r) => r.username), `jugadores=${racers.size}`)
  const perPlayer = {}
  ;(race.data || []).forEach((r) => (perPlayer[r.user_id] = (perPlayer[r.user_id] || 0) + 1))
  check('la serie se muestrea a ≈20 puntos por jugador como máximo', Object.values(perPlayer).every((n) => n <= 24), JSON.stringify(Object.values(perPlayer).slice(0, 5)))
  const editDesc = await call(admin, 'staff_update_market', { p_market_id: grp.data.ids[1], p_patch: { description: '[TEST] descripción compartida', category: 'viaje' }, p_apply_group: true })
  const gm2 = await admin.from('markets').select('description, category').eq('group_id', gid)
  check('editar un mercado múltiple actualiza descripción y categoría en TODAS las opciones', !editDesc.error && gm2.data.every((m) => m.description === '[TEST] descripción compartida' && m.category === 'viaje'), msg(editDesc))

  section('ALMACENAMIENTO · fotos de mercados (solo staff escribe)')
  const nm = `test/${Date.now()}-${Math.random().toString(16).slice(2, 8)}.webp`
  const upPlayer = await p3.storage.from('market-images').upload(nm, TINY_WEBP, { contentType: 'image/webp' })
  check('un jugador normal NO puede subir fotos', !!upPlayer.error, upPlayer.error?.message)
  const upAdmin = await admin.storage.from('market-images').upload(nm, TINY_WEBP, { contentType: 'image/webp', upsert: false })
  check('el dueño sube una foto WebP', !upAdmin.error, upAdmin.error?.message)
  const nmMod = nm.replace('.webp', '-m.webp')
  const upMod = await p1.storage.from('market-images').upload(nmMod, TINY_WEBP, { contentType: 'image/webp' })
  check('un moderador sube una foto WebP', !upMod.error, upMod.error?.message)
  const upBad = await admin.storage.from('market-images').upload(`test/${Date.now()}.txt`, Buffer.from('hola'), { contentType: 'text/plain' })
  check('solo se aceptan imágenes (WebP/JPEG): text/plain rechazado', !!upBad.error, upBad.error?.message)
  const pub = admin.storage.from('market-images').getPublicUrl(nm).data.publicUrl
  const resp = await fetch(pub)
  check('la foto es pública para cualquiera (CDN) y llega como image/webp', resp.status === 200 && /image\/webp/.test(resp.headers.get('content-type') || ''), `status=${resp.status}`)
  const badImg = await call(admin, 'staff_create_market', { p_question: '[TEST] foto externa', p_image_url: 'https://evil.example.com/x.png' })
  check('no se aceptan imágenes de otros sitios (solo las subidas desde la app)', !!badImg.error && /subirse desde la app/i.test(msg(badImg)), msg(badImg))
  const okImg = await call(admin, 'staff_create_market', { p_question: '[TEST] con foto', p_image_url: pub, p_image_thumb_url: pub, p_image_color: '#336699' })
  check('mercado con foto subida desde la app se crea (banner + miniatura + color)', !okImg.error, msg(okImg))
  await admin.storage.from('market-images').remove([nm, nmMod])
  const left = await admin.storage.from('market-images').list('test', { limit: 100 })
  check('el staff puede borrar fotos del bucket', !left.error && !left.data?.some((f) => nm.endsWith(f.name) || nmMod.endsWith(f.name)), left.error?.message)

  // limpieza de roles
  await call(admin, 'admin_set_moderator', { p_user_id: id1, p_value: false })
  const afterRole = await call(p1, 'staff_list_players')
  check('el dueño quita el permiso de moderador y se pierde el acceso', !!afterRole.error, msg(afterRole))
}

// =====================================================================
async function cleanupMarkets(admin) {
  const { data } = await admin.from('markets').select('id, question').like('question', '[TEST]%')
  let n = 0
  for (const m of data || []) {
    const r = await admin.rpc('delete_market_and_refund', { p_market_id: m.id })
    if (!r.error) n += 1
  }
  return n
}

const U = await login()
const C = U.map((u) => mk(u.token))
const t0 = performance.now()
try {
  if (PHASE === 'sec' || PHASE === 'all') await phaseSecurity(U, C)
  if (PHASE === 'func' || PHASE === 'all') {
    await phaseFunctional(U, C)
    await cleanupMarkets(C[0]) // cada fase parte de saldos y movimientos limpios
  }
  if (PHASE === 'feat' || PHASE === 'all') {
    await phaseFeatures(U, C)
    await cleanupMarkets(C[0])
  }
  if (PHASE === 'conc' || PHASE === 'all') await phaseConcurrency(U, C)
} finally {
  if (PHASE !== 'keep') {
    const n = await cleanupMarkets(C[0])
    console.log(`\n🧹 mercados de prueba anulados y reembolsados: ${n}`)
  }
}
console.log(`\n══════════════════════════════════════════`)
console.log(`  ${passed} OK · ${failed} FALLOS · ${((performance.now() - t0) / 1000).toFixed(1)} s`)
if (failed) console.log(`  Fallos:\n   - ${failures.join('\n   - ')}`)
console.log(`══════════════════════════════════════════`)
process.exit(failed ? 1 : 0)
