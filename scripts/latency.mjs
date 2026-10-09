// Mide latencia secuencial (sin contención): lectura vs. operación de compra/venta.
// Uso: LOADTEST_ENV=/ruta/testenv.json node scripts/latency.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newRequestId } from '../src/lib/trading.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_FILE = process.env.LOADTEST_ENV
const state = JSON.parse(fs.readFileSync(path.join(path.dirname(ENV_FILE), 'sessions.json'), 'utf8'))
const dot = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const mk = (token) =>
  createClient(dot.VITE_SUPABASE_URL, dot.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
const admin = mk(state.users[0].token)
const p = mk(state.users[5].token)
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const time = async (fn) => {
  const t = performance.now()
  await fn()
  return performance.now() - t
}

const market = (await admin.rpc('staff_create_market', { p_question: '[TEST] latencia' })).data
const reads = []
const trades = []
for (let i = 0; i < 25; i += 1) {
  reads.push(await time(() => p.rpc('get_daily_moves')))
  trades.push(
    await time(() =>
      p.rpc('buy_shares', { p_market_id: market, p_side: i % 2 ? 'YES' : 'NO', p_investment: 2, p_max_price: 1, p_request_id: newRequestId() })
    )
  )
}
console.log(`lectura get_daily_moves  : mediana ${med(reads).toFixed(0)} ms  (≈ ida y vuelta de red)`)
console.log(`compra buy_shares        : mediana ${med(trades).toFixed(0)} ms`)
console.log(`⇒ tiempo extra de la operación (≈ lo que dura el bloqueo del mercado): ${(med(trades) - med(reads)).toFixed(0)} ms`)
await admin.rpc('delete_market_and_refund', { p_market_id: market })
