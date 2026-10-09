import { spotPrice } from './trading'

// Precio de un lado: si el mercado trae piscinas se calcula; si viene de un
// archivo (Recuerdos) ya trae yes_price / no_price calculados.
const priceOf = (m, side) =>
  m.yes_pool !== undefined ? spotPrice(m, side) : Number(side === 'YES' ? m.yes_price : m.no_price)

/**
 * Convierte una posición cruda (acciones + costo promedio) en los números que
 * muestra la UI. `market` aporta los precios/estado actuales (si no se pasa,
 * se usa lo que trae la propia posición).
 */
export function buildPosition(raw, market) {
  const m = market || raw
  const shares = Number(raw.shares)
  const avgCost = Number(raw.avg_cost)
  const costBasis = shares * avgCost
  const closed = !!m.closed
  const isWinner = closed ? raw.side === m.outcome : null
  const currentPrice = closed ? (isWinner ? 1 : 0) : priceOf(m, raw.side)
  const currentValue = shares * currentPrice
  const pnl = currentValue - costBasis
  return {
    key: `${raw.market_id}-${raw.side}`,
    marketId: raw.market_id,
    question: raw.question,
    groupTopic: raw.group_topic,
    side: raw.side,
    shares,
    avgCost,
    currentPrice,
    currentValue,
    costBasis,
    pnl,
    pnlPercent: costBasis > 0 ? (pnl / costBasis) * 100 : 0,
    closed,
    pending: m.state === 'pending',
    isWinner,
    outcome: m.outcome,
  }
}

/** Agrupa posiciones por tópico (mercados múltiples) manteniendo el orden. */
export function groupPositions(positions) {
  const particular = []
  const groups = new Map()
  for (const p of positions) {
    if (p.groupTopic) {
      if (!groups.has(p.groupTopic)) groups.set(p.groupTopic, [])
      groups.get(p.groupTopic).push(p)
    } else {
      particular.push(p)
    }
  }
  return { particular, groups: [...groups.entries()] }
}
