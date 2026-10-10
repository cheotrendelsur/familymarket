// FamilyMarket · envío de notificaciones push (Web Push con claves VAPID propias, sin servicios de terceros).
// La llama la base de datos (pg_cron cada minuto y al instante cuando hay resultados) con un secreto compartido
// (cabecera x-push-secret = push_config.secret). Se despliega con verify_jwt = false (la protege el secreto).
// 1) la primera vez genera las claves VAPID y las guarda en push_config  2) reclama los mensajes pendientes con push_claim_jobs()
// 3) los envía; los teléfonos que ya no existen (404/410) se borran.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  let { data: cfg } = await sb.from('push_config').select('*').limit(1).maybeSingle()
  if (!cfg) return json({ error: 'sin configuración' }, 500)
  if (req.headers.get('x-push-secret') !== cfg.secret) return json({ error: 'no autorizado' }, 401)

  // Primera vez: se generan las claves VAPID (solo se guardan si todavía no hay).
  if (!cfg.vapid_public || !cfg.vapid_private) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const pub = b64url(await crypto.subtle.exportKey('raw', kp.publicKey))
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
    await sb.from('push_config').update({ vapid_public: pub, vapid_private: jwk.d }).eq('id', true).is('vapid_public', null)
    const again = await sb.from('push_config').select('*').limit(1).maybeSingle()
    cfg = again.data
    if (!cfg?.vapid_public || !cfg?.vapid_private) return json({ error: 'no se pudieron guardar las claves' }, 500)
  }

  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private)

  const { data: jobs, error } = await sb.rpc('push_claim_jobs')
  if (error) return json({ error: error.message }, 500)
  const list = (jobs ?? []) as Array<Record<string, any>>

  let sent = 0
  let gone = 0
  let failed = 0
  for (let i = 0; i < list.length; i += 10) {
    await Promise.all(
      list.slice(i, i + 10).map(async (j) => {
        try {
          await webpush.sendNotification(
            { endpoint: j.endpoint, keys: { p256dh: j.p256dh, auth: j.auth_key } },
            JSON.stringify({ title: j.title, body: j.body, url: j.url, tag: j.tag, kind: j.kind }),
            { TTL: j.ttl, urgency: j.kind === 'closing_soon' || j.kind === 'test' ? 'high' : 'normal', timeout: 8000 },
          )
          sent += 1
        } catch (e) {
          const code = (e as { statusCode?: number })?.statusCode
          if (code === 404 || code === 410) {
            gone += 1
            await sb.rpc('push_drop_endpoint', { p_endpoint: j.endpoint, p_gone: true })
          } else {
            failed += 1
            await sb.rpc('push_drop_endpoint', { p_endpoint: j.endpoint, p_gone: false })
          }
        }
      }),
    )
  }
  return json({ ok: true, jobs: list.length, sent, gone, failed })
})
