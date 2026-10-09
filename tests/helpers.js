import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const URL_ = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const creds = () => {
  const file = process.env.LOADTEST_ENV
  if (!file) throw new Error('Define LOADTEST_ENV con la ruta al archivo de credenciales de prueba')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
const emailOf = (c, i) => `${c.prefix}${String(i).padStart(2, '0')}@${c.domain}`

/** Cliente de API (sin persistencia) autenticado como el usuario de prueba i. */
export async function apiClient(i) {
  const c = creds()
  const client = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signInWithPassword({ email: emailOf(c, i), password: c.password })
  if (error) throw new Error(`login ${i}: ${error.message}`)
  return { client, user: data.user }
}

/**
 * Deja la sesión del usuario de prueba i en el localStorage de jsdom, de modo que
 * la app (que crea su propio cliente al importarse) arranca ya autenticada.
 */
export async function loginInBrowser(i) {
  const c = creds()
  const client = createClient(URL_, KEY, {
    auth: { persistSession: true, storage: window.localStorage, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email: emailOf(c, i), password: c.password })
  if (error) throw new Error(`login ${i}: ${error.message}`)
  return data.user
}

export const goto = (path) => window.history.pushState({}, '', path)
