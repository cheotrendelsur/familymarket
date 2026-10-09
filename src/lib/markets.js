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

/** Mismo criterio que la política RLS del servidor (defensa en profundidad en el cliente). */
export function isVisibleTo(market, profile) {
  if (!profile) return false
  if (profile.is_admin) return true
  const blocked = market.target_users
  return !blocked || blocked.length === 0 || !blocked.includes(profile.id)
}
