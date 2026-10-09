// Micro-benchmark de rendimiento: K mercados, T operaciones, I peticiones en vuelo.
// Uso: LOADTEST_ENV=/ruta/testenv.json node scripts/throughput.mjs
// Nota: mas de ~30 conexiones simultaneas desde UNA sola IP saturan el cliente/red local
// (no la base de datos), asi que se mide hasta ese punto.
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
const clients = state.users.map((u) => mk(u.token))
const admin = clients[0]
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]

async function run(K, T, I) {
  const markets = []
  for (let k = 0; k < K; k += 1) markets.push((await admin.rpc('admin_create_market', { p_question: `[TEST] bench ${k}` })).data)
  let inflight = 0
  const waiters = []
  const acquire = async () => {
    if (inflight >= I) await new Promise((r) => waiters.push(r))
    inflight += 1
  }
  const release = () => {
    inflight -= 1
    waiters.shift()?.()
  }
  const lat = []
  let errors = 0
  const errKinds = {}
  const t0 = performance.now()
  await Promise.all(
    Array.from({ length: T }, async (_, n) => {
      await acquire()
      try {
        const u = process.env.GROUPED ? 1 + Math.floor(n / 15) % 13 : 1 + (n % 13)
        const m = markets[n % K]
        const t = performance.now()
        const { error } = await clients[u].rpc('buy_shares', {
          p_market_id: m, p_side: n % 2 ? 'YES' : 'NO', p_investment: 3, p_max_price: 1, p_request_id: newRequestId(),
        })
        lat.push(performance.now() - t)
        if (error) {
          errors += 1
          errKinds[error.message.slice(0, 50)] = (errKinds[error.message.slice(0, 50)] || 0) + 1
        }
      } finally {
        release()
      }
    })
  )
  const wall = performance.now() - t0
  for (const m of markets) await admin.rpc('delete_market_and_refund', { p_market_id: m })
  console.log(
    `K=${String(K).padStart(2)} mercados | T=${T} ops | en vuelo=${String(I).padStart(2)} -> ${(T / (wall / 1000)).toFixed(1).padStart(6)} ops/s | p50=${pct(lat, 50).toFixed(0)}ms p95=${pct(lat, 95).toFixed(0)}ms | errores=${errors} ${errors ? JSON.stringify(errKinds) : ''}`
  )
}

for (const [K, T, I] of [[1, 150, 30], [1, 150, 30]]) {
  await run(K, T, I)
  await new Promise((r) => setTimeout(r, 1500))
}
