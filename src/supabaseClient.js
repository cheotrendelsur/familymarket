import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan las variables de entorno de Supabase (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // No usamos OAuth ni magic links: evita trabajo extra al cargar.
    detectSessionInUrl: false,
  },
  // La app actualiza por sondeo (polling) y no por Realtime: así el costo por
  // usuario es constante y no hay límites de conexiones simultáneas que alcanzar.
  realtime: { params: { eventsPerSecond: 1 } },
  global: { headers: { 'x-client-info': 'familymarket-web' } },
})
