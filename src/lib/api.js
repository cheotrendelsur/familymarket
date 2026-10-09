import { supabase } from '../supabaseClient'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Errores de red/saturación: son seguros de reintentar (las operaciones de
// trading llevan p_request_id, así que el servidor nunca las ejecuta dos veces).
const TRANSIENT = /Failed to fetch|NetworkError|Load failed|network request failed|PGRST003|Timeout acquiring|502|503|504/i

/**
 * Llama a una función RPC. Lanza el error de Supabase si falla.
 * @param {string} name
 * @param {object} args
 * @param {{retries?: number}} opts  reintentos ante errores transitorios
 */
export async function rpc(name, args = {}, { retries = 0 } = {}) {
  let attempt = 0
  for (;;) {
    const { data, error } = await supabase.rpc(name, args)
    if (!error) return data
    if (attempt < retries && TRANSIENT.test(error.message || '')) {
      attempt += 1
      await sleep(350 * attempt + Math.random() * 300)
      continue
    }
    throw error
  }
}
