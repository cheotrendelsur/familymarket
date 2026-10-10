import { supabase } from '../supabaseClient'

// Modo demo (solo desarrollo, `?mock=1`): sustituye el backend por datos en memoria
// para revisar la interfaz sin tocar la base real. En producción esta rama se elimina
// por completo del bundle (import.meta.env.DEV es false).
const MOCK =
  import.meta.env.DEV && typeof window !== 'undefined'
    ? (() => {
        try {
          if (new URLSearchParams(window.location.search).has('mock')) window.sessionStorage.setItem('fm_mock', '1')
          return window.sessionStorage.getItem('fm_mock') === '1'
        } catch {
          return false
        }
      })()
    : false
const mockPromise = MOCK ? import('../mock/backend.js') : null
export const isMock = MOCK

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
  if (mockPromise) return (await mockPromise).rpc(name, args)
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

const unwrap = ({ data, error }) => {
  if (error) throw error
  return data
}

// Columnas "estáticas" de un mercado (cambian rara vez; se descargan una sola vez).
export const STATIC_COLUMNS =
  'id, question, description, image_url, image_thumb_url, image_color, group_topic, group_id, category, created_at, created_by, resolved_at'

/** Lecturas directas de tablas (todas protegidas por RLS). */
export const db = {
  async gameSettings() {
    if (mockPromise) return (await mockPromise).db.gameSettings()
    return unwrap(
      await supabase
        .from('game_settings')
        .select('daily_limit, fee_rate, initial_liquidity, initial_balance, min_price, max_price, min_trade')
        .maybeSingle()
    )
  },
  async marketsByIds(ids, { withTargets = false } = {}) {
    if (mockPromise) return (await mockPromise).db.marketsByIds(ids)
    const cols = withTargets ? `${STATIC_COLUMNS}, target_users` : STATIC_COLUMNS
    const out = []
    for (let i = 0; i < ids.length; i += 60) {
      const chunk = ids.slice(i, i + 60)
      const rows = unwrap(await supabase.from('markets').select(cols).in('id', chunk))
      out.push(...(rows || []))
    }
    return out
  },
  async myShares(marketId) {
    if (mockPromise) return (await mockPromise).db.myShares(marketId)
    return unwrap(await supabase.from('shares').select('side, count').eq('market_id', marketId)) || []
  },
  async myOperations(limit = 100) {
    if (mockPromise) return (await mockPromise).db.myOperations(limit)
    return (
      unwrap(
        await supabase
          .from('transactions')
          .select('id, market_id, type, side, shares_amount, price_per_share, total_cost, created_at, markets(question, group_topic)')
          .order('created_at', { ascending: false })
          .limit(limit)
      ) || []
    )
  },
  async profile(userId) {
    if (mockPromise) return (await mockPromise).db.profile(userId)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, balance, is_admin, is_moderator, email, tour_completed_at')
      .eq('id', userId)
      .maybeSingle()
    return { data, error }
  },
  /** Sube un archivo al bucket de imágenes y devuelve su URL pública. */
  async uploadImage(path, blob, contentType) {
    if (mockPromise) return (await mockPromise).db.uploadImage(path, blob, contentType)
    const bucket = supabase.storage.from('market-images')
    const { error } = await bucket.upload(path, blob, { contentType, cacheControl: '31536000', upsert: false })
    if (error) throw error
    return bucket.getPublicUrl(path).data.publicUrl
  },
  async removeImages(paths) {
    if (mockPromise) return undefined
    await supabase.storage.from('market-images').remove(paths)
    return undefined
  },
}

/** Autenticación (envoltura para poder simularla en modo demo). */
export const auth = {
  async getSession() {
    if (mockPromise) return (await mockPromise).auth.getSession()
    return supabase.auth.getSession()
  },
  onChange(callback) {
    if (mockPromise) {
      let unsubscribe = () => {}
      mockPromise.then((m) => {
        unsubscribe = m.auth.onChange(callback)
      })
      return () => unsubscribe()
    }
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(callback)
    return () => subscription.unsubscribe()
  },
  async signIn(email, password) {
    if (mockPromise) return (await mockPromise).auth.signIn(email, password)
    return supabase.auth.signInWithPassword({ email, password })
  },
  /** `data` viaja como metadatos del usuario (nombre y código de la familia: los lee la base de datos al crear la cuenta). */
  async signUp(email, password, data) {
    if (mockPromise) return (await mockPromise).auth.signUp(email, password, data)
    return supabase.auth.signUp({ email, password, options: data ? { data } : undefined })
  },
  /** Redirige a Google; al volver, Supabase deja la sesión lista (ver supabaseClient.js). */
  async signInWithGoogle() {
    if (mockPromise) return (await mockPromise).auth.signInWithGoogle()
    return supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/`, queryParams: { prompt: 'select_account' } },
    })
  },
  /** ¿Está activado «Entrar con Google» en Supabase? Si no, la pantalla solo ofrece correo y contraseña. */
  async googleEnabled() {
    if (mockPromise) return true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        signal: controller.signal,
      })
      if (!res.ok) return false
      const settings = await res.json()
      return !!settings?.external?.google
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  },
  async signOut() {
    if (mockPromise) return (await mockPromise).auth.signOut()
    return supabase.auth.signOut()
  },
}
