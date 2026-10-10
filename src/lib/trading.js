// =====================================================================
// Matemática del mercado (CPMM) — ÚNICA implementación para toda la app.
// Replica exactamente las funciones SQL buy_shares / sell_shares para que
// la vista previa coincida con lo que realmente se ejecuta en el servidor.
//   · Dinero: 4 decimales   · Acciones: 6 decimales
// =====================================================================

export const DEFAULT_CONFIG = {
  daily_limit: 60,
  fee_rate: 0.02,
  initial_liquidity: 2000,
  initial_balance: 1000,
  min_price: 0.01,
  max_price: 0.99,
  min_trade: 0.01,
}

const round = (n, dp) => {
  const f = 10 ** dp
  return Math.round((n + Number.EPSILON) * f) / f
}
export const roundMoney = (n) => round(n, 4)
export const roundShares = (n) => round(n, 6)

/** Parsea de forma segura un número de input (acepta coma decimal). */
export const parseAmount = (value) => {
  if (value === null || value === undefined || value === '') return NaN
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

/** Precio spot de un lado: lo define la piscina CONTRARIA. */
export function spotPrice(market, side) {
  const yes = Number(market.yes_pool)
  const no = Number(market.no_pool)
  const total = yes + no
  if (!(total > 0)) return 0.5
  return side === 'YES' ? no / total : yes / total
}

export const yesPrice = (market) => spotPrice(market, 'YES')
export const noPrice = (market) => spotPrice(market, 'NO')

/**
 * Cotiza una COMPRA (mint & swap).
 * @returns {{error?: string, shares, avgPrice, fee, finalPrice, priceImpact, newYesPool, newNoPool, investment}}
 */
export function quoteBuy(market, side, amount, cfg = DEFAULT_CONFIG) {
  const investment = roundMoney(amount)
  if (!(investment >= cfg.min_trade)) {
    return { error: `La inversión mínima es $${cfg.min_trade}` }
  }
  let yes = Number(market.yes_pool)
  let no = Number(market.no_pool)
  const k = yes * no
  const fee = roundMoney(investment * cfg.fee_rate)
  const net = investment - fee
  const current = spotPrice(market, side)

  let swap
  if (side === 'YES') {
    const other = no + net
    const sel = k / other
    swap = yes - sel
    yes = sel
    no = other
  } else {
    const other = yes + net
    const sel = k / other
    swap = no - sel
    no = sel
    yes = other
  }

  const shares = roundShares(net + swap)
  if (!(shares > 0)) return { error: 'La inversión es demasiado pequeña' }
  const finalPrice = side === 'YES' ? no / (yes + no) : yes / (yes + no)
  if (finalPrice > cfg.max_price) {
    return { error: `El precio excedería ${Math.round(cfg.max_price * 100)}¢. Reduce la inversión.` }
  }
  return {
    investment,
    fee,
    shares,
    avgPrice: investment / shares,
    finalPrice,
    priceImpact: current > 0 ? ((finalPrice - current) / current) * 100 : 0,
    newYesPool: yes,
    newNoPool: no,
  }
}

/**
 * Cotiza una VENTA (reverse mint).
 * @returns {{error?: string, payout, avgPrice, fee, finalPrice, priceImpact, shares}}
 */
export function quoteSell(market, side, sharesToSell, cfg = DEFAULT_CONFIG) {
  const s = roundShares(sharesToSell)
  if (!(s > 0)) return { error: 'Cantidad inválida' }
  let yes = Number(market.yes_pool)
  let no = Number(market.no_pool)
  const k = yes * no
  const current = spotPrice(market, side)
  const [y, n] = side === 'YES' ? [yes, no] : [no, yes]

  const b = y + n - s
  const c = y * (n - s) - k
  const disc = b * b - 4 * c
  if (disc < 0) return { error: 'La cantidad es demasiado alta para vender' }
  let swap = (-b + Math.sqrt(disc)) / 2
  if (swap < -1e-6 || swap > s + 1e-6) return { error: 'Error en el cálculo de venta' }
  swap = Math.min(Math.max(swap, 0), s)

  const gross = s - swap
  const fee = roundMoney(gross * cfg.fee_rate)
  const payout = roundMoney(gross - fee)
  if (!(payout > 0)) return { error: 'El monto de venta es muy bajo' }

  if (side === 'YES') {
    yes += swap
    no = k / yes
  } else {
    no += swap
    yes = k / no
  }
  const finalPrice = side === 'YES' ? no / (yes + no) : yes / (yes + no)
  if (finalPrice < cfg.min_price) {
    return { error: `El precio caería por debajo de ${Math.round(cfg.min_price * 100)}¢. Vende menos.` }
  }
  return {
    shares: s,
    payout,
    fee,
    avgPrice: payout / s,
    finalPrice,
    priceImpact: current > 0 ? ((finalPrice - current) / current) * 100 : 0,
    newYesPool: yes,
    newNoPool: no,
  }
}

/** Precio máximo (compra) / mínimo (venta) aceptable según la tolerancia de slippage (%). */
export const maxAvgPrice = (quotedAvg, tolerancePct) => Math.min(quotedAvg * (1 + tolerancePct / 100), 1)
export const minAvgPrice = (quotedAvg, tolerancePct) => Math.max(quotedAvg * (1 - tolerancePct / 100), 0)

/** Id de solicitud para que reintentos / doble toque no dupliquen la operación. */
export function newRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // Fallback RFC4122 v4 para navegadores antiguos
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
