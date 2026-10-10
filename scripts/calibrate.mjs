// =====================================================================
// Calibración de la liquidez inicial (el "1200") según la cantidad de jugadores.
//   node scripts/calibrate.mjs            -> tabla comparativa
//   node scripts/calibrate.mjs 40 2000    -> detalle de un caso (N jugadores, liquidez L)
//
// Usa la MISMA matemática que el servidor (src/lib/trading.js, verificada contra SQL en
// scripts/audit.mjs). Cada jugador tiene una creencia propia (ruidosa) sobre la probabilidad
// real, compra del lado que cree infravalorado y vende si cambia de opinión.
// Mide: cuánto se mueve el precio por operación, si el mercado se satura (≥95 % o ≤5 %),
// qué tan cerca termina de la probabilidad real y cuánto dinero "crea o destruye" el mercado.
// =====================================================================
import { DEFAULT_CONFIG, quoteBuy, quoteSell, spotPrice } from '../src/lib/trading.js'

const cfg = { ...DEFAULT_CONFIG }

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
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

/** Un mercado completo con N jugadores. Devuelve métricas. */
export function simulateMarket({ N, L, seed, rounds = 4 }) {
  const r = rng(seed)
  const market = { yes_pool: L, no_pool: L }
  const trueP = 0.1 + 0.8 * r()
  const players = Array.from({ length: N }, () => {
    const style = r()
    return {
      balance: cfg.initial_balance,
      start: cfg.initial_balance,
      belief: clamp(trueP + gauss(r) * 0.15, 0.03, 0.97),
      // casual (55 %), decidido (35 %), apostador fuerte (10 %)
      kappa: style < 0.55 ? 0.4 : style < 0.9 ? 1 : 2.2,
      yes: 0,
      no: 0,
    }
  })
  const moves = [] // cambio de precio de Sí (puntos porcentuales) por operación
  let trades = 0
  let capHits = 0
  for (let round = 0; round < rounds; round += 1) {
    const order = [...players].sort(() => r() - 0.5)
    for (const p of order) {
      if (r() > 0.7) continue // no todos entran a cada ronda
      const price = spotPrice(market, 'YES')
      const edge = p.belief - price
      if (Math.abs(edge) < 0.03) continue
      const before = price
      const side = edge > 0 ? 'YES' : 'NO'
      const opposite = side === 'YES' ? 'no' : 'yes'
      if (p[opposite] > 0.0001) {
        // cambió de opinión: vende lo que tenía del lado contrario
        const q = quoteSell(market, side === 'YES' ? 'NO' : 'YES', p[opposite], cfg)
        if (q.error) continue
        market.yes_pool = q.newYesPool
        market.no_pool = q.newNoPool
        p.balance += q.payout
        p[opposite] = 0
      } else {
        const stake = clamp(Math.abs(edge) * p.balance * p.kappa, 5, 0.3 * p.balance)
        const q = quoteBuy(market, side, stake, cfg)
        if (q.error) {
          capHits += 1
          continue
        }
        market.yes_pool = q.newYesPool
        market.no_pool = q.newNoPool
        p.balance -= q.investment
        p[side === 'YES' ? 'yes' : 'no'] += q.shares
      }
      trades += 1
      moves.push(Math.abs(spotPrice(market, 'YES') - before) * 100)
    }
  }
  const final = spotPrice(market, 'YES')
  const outcomeYes = r() < trueP
  let profit = 0
  for (const p of players) {
    const payout = outcomeYes ? p.yes : p.no
    profit += p.balance + payout - p.start
  }
  return { trueP, final, trades, moves, capHits, saturated: final > 0.95 || final < 0.05, created: profit, supply: N * cfg.initial_balance }
}

export function evaluate(N, L, markets = 400) {
  const all = []
  const created = []
  let sat = 0
  let err = 0
  let caps = 0
  let trades = 0
  for (let i = 0; i < markets; i += 1) {
    const m = simulateMarket({ N, L, seed: 1000 + i * 7919 })
    all.push(...m.moves)
    created.push((m.created / m.supply) * 100)
    sat += m.saturated ? 1 : 0
    err += Math.abs(m.final - m.trueP) * 100
    caps += m.capHits
    trades += m.trades
  }
  return {
    N,
    L,
    stepAvg: mean(all),
    stepP95: pct(all, 95),
    stepMax: Math.max(...all),
    saturated: (sat / markets) * 100,
    error: err / markets,
    createdMean: mean(created),
    createdP5: pct(created, 5),
    createdP95: pct(created, 95),
    tradesPerMarket: trades / markets,
    capHits: caps / markets,
  }
}

/** Escenarios deterministas fáciles de entender. */
export function scenarios(L) {
  const out = {}
  const m0 = { yes_pool: L, no_pool: L }
  out.bet10 = (quoteBuy(m0, 'YES', 10, cfg).finalPrice - 0.5) * 100
  out.bet50 = (quoteBuy(m0, 'YES', 50, cfg).finalPrice - 0.5) * 100
  out.bet200 = (quoteBuy(m0, 'YES', 200, cfg).finalPrice - 0.5) * 100
  out.allIn = (quoteBuy(m0, 'YES', 1000, cfg).finalPrice - 0.5) * 100
  for (const [n, stake] of [[40, 100], [40, 50], [20, 100]]) {
    const m = { yes_pool: L, no_pool: L }
    for (let i = 0; i < n; i += 1) {
      const q = quoteBuy(m, 'YES', stake, cfg)
      if (q.error) break
      m.yes_pool = q.newYesPool
      m.no_pool = q.newNoPool
    }
    out[`stampede${n}x${stake}`] = spotPrice(m, 'YES') * 100
  }
  // costo de "inflar" y revender: compra 300 de Sí y vende todo enseguida
  const m = { yes_pool: L, no_pool: L }
  const b = quoteBuy(m, 'YES', 300, cfg)
  m.yes_pool = b.newYesPool
  m.no_pool = b.newNoPool
  const s = quoteSell(m, 'YES', b.shares, cfg)
  out.roundTrip300 = s.payout - 300 // pérdida por ir y volver (comisión 2 % x2 + 0 de deslizamiento neto)
  // dinero máximo que el mercado puede regalar (si todos aciertan hasta el 99 %)
  out.maxSubsidy = L
  return out
}

const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—')

if (process.argv[1] && process.argv[1].endsWith('calibrate.mjs')) {
  const [argN, argL] = process.argv.slice(2).map(Number)
  const Ns = argN ? [argN] : [9, 20, 40]
  const Ls = argL ? [argL] : [600, 1200, 2000, 3000, 5000]
  console.log('\nEscenarios deterministas (solo dependen de la liquidez L)')
  console.log('  L      | $10→  $50→  $200→  $1000→ (puntos que sube el precio) | 40×$100 / 40×$50 / 20×$100 → precio de Sí | ir y volver con $300 | regalo máx.')
  for (const L of Ls) {
    const s = scenarios(L)
    console.log(
      `  ${String(L).padEnd(6)} | +${fmt(s.bet10)}  +${fmt(s.bet50)}  +${fmt(s.bet200)}  +${fmt(s.allIn)}   | ${fmt(s.stampede40x100)}% / ${fmt(s.stampede40x50)}% / ${fmt(s.stampede20x100)}%   | ${fmt(s.roundTrip300, 2)} | $${L}`
    )
  }
  console.log('\nSimulación con creencias heterogéneas (400 mercados por celda)')
  console.log('  N   L     | Δprecio/op media  p95   máx | saturados≥95/≤5 | error vs real | dinero creado/destruido por mercado (% del dinero total): media  p5  p95 | ops/mercado | topes 99¢')
  for (const N of Ns) {
    for (const L of Ls) {
      const e = evaluate(N, L)
      console.log(
        `  ${String(N).padEnd(3)} ${String(L).padEnd(5)} | ${fmt(e.stepAvg)}pp  ${fmt(e.stepP95)}  ${fmt(e.stepMax)} | ${fmt(e.saturated, 0)}% | ${fmt(e.error)}pp | ${fmt(e.createdMean, 2)}%  ${fmt(e.createdP5, 2)}%  ${fmt(e.createdP95, 2)}% | ${fmt(e.tradesPerMarket, 0)} | ${fmt(e.capHits, 2)}`
      )
    }
    console.log('')
  }
}
