// Notificaciones push (Android y iPhone): estado, activar, desactivar y mantener la suscripción al día.
// En iPhone solo funcionan con la app instalada en la pantalla de inicio (iOS 16.4 o más nuevo) y el permiso lo tiene que
// pedir un toque del jugador; por eso todo se dispara desde botones.
import { rpc } from './api'

/** Solo para la vista previa y las pruebas (modo demo): `window.__fmPush = { status: 'ask' }` simula cada situación. */
const override = () => (import.meta.env.DEV && typeof window !== 'undefined' ? window.__fmPush || null : null)

export const isIOS = () => {
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}
export const isAndroid = () => /Android/i.test(navigator.userAgent || '')
export const isStandalone = () => window.navigator.standalone === true || !!window.matchMedia?.('(display-mode: standalone)')?.matches

export const pushCapable = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const withTimeout = (promise, ms, message) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message || 'Tardó demasiado')), ms))])

export function urlBase64ToUint8Array(base64) {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const bufferToBase64Url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function getRegistration(ms = 4000) {
  return withTimeout(navigator.serviceWorker.ready, ms, 'El service worker no está listo')
}

async function getSubscription() {
  try {
    const reg = await getRegistration()
    return await reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

/**
 * ¿En qué situación está este teléfono?
 *  · active: ya recibe avisos            · ask: se puede pedir el permiso (o falta renovar la suscripción)
 *  · denied: el permiso está bloqueado   · install: iPhone con la app sin instalar (en Safari)
 *  · old: iPhone con la app instalada pero con un iOS anterior al 16.4   · unsupported: este navegador no puede
 */
export async function getPushStatus() {
  const o = override()
  if (o) return o.status
  if (!pushCapable()) {
    if (isIOS()) return isStandalone() ? 'old' : 'install'
    return 'unsupported'
  }
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission === 'granted') return (await getSubscription()) ? 'active' : 'ask'
  return 'ask'
}

async function subscribeAndSave() {
  const state = await rpc('get_push_state')
  const key = state?.public_key
  if (!key) throw new Error('Las notificaciones todavía no están listas en el servidor. Inténtalo en un minuto.')
  const reg = await getRegistration(9000).catch(() => {
    throw new Error('La app todavía se está preparando. Ciérrala, ábrela otra vez y vuelve a intentarlo.')
  })
  let sub = await reg.pushManager.getSubscription()
  // Si el servidor cambió de claves, la suscripción vieja ya no sirve: se renueva.
  if (sub?.options?.applicationServerKey && bufferToBase64Url(sub.options.applicationServerKey) !== key) {
    await sub.unsubscribe()
    sub = null
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
  const json = sub.toJSON()
  await rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_user_agent: (navigator.userAgent || '').slice(0, 300),
  })
}

/**
 * Activa las notificaciones. DEBE llamarse directamente desde un toque (iPhone lo exige).
 * Devuelve { ok } o { ok:false, reason: 'denied' | 'dismissed' | 'unsupported' | 'error', message }.
 */
export async function enablePush() {
  const o = override()
  if (o) {
    if (o.denyNext) {
      o.denyNext = false
      o.status = 'denied'
      return { ok: false, reason: 'denied' }
    }
    await rpc('save_push_subscription', { p_endpoint: 'https://mock.push/endpoint', p_p256dh: 'k', p_auth: 'a', p_user_agent: 'mock' })
    o.status = 'active'
    return { ok: true }
  }
  if (!pushCapable()) return { ok: false, reason: 'unsupported' }
  let permission = Notification.permission
  if (permission === 'default') permission = await Notification.requestPermission()
  if (permission === 'denied') return { ok: false, reason: 'denied' }
  if (permission !== 'granted') return { ok: false, reason: 'dismissed' }
  try {
    await subscribeAndSave()
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: 'error', message: err?.message || 'No se pudo activar' }
  }
}

export async function disablePush() {
  const o = override()
  if (o) {
    await rpc('remove_push_subscription', { p_endpoint: 'https://mock.push/endpoint' })
    o.status = 'ask'
    return true
  }
  const sub = await getSubscription()
  if (sub) {
    await rpc('remove_push_subscription', { p_endpoint: sub.endpoint }).catch(() => {})
    await sub.unsubscribe().catch(() => {})
  }
  return true
}

/**
 * Se llama cada vez que se abre la app con la sesión iniciada: renueva la suscripción en el servidor (iPhone a veces la pierde)
 * y, si el permiso ya estaba concedido pero falta la suscripción, la recrea sin molestar. Devuelve el estado final.
 */
export async function syncPush() {
  const o = override()
  if (o) return o.status
  let status = await getPushStatus()
  try {
    if (status === 'active') await subscribeAndSave()
    else if (status === 'ask' && pushCapable() && Notification.permission === 'granted') {
      await subscribeAndSave()
      status = 'active'
    }
  } catch {
    /* sin conexión o servidor sin claves aún: se reintenta la próxima vez */
  }
  return status
}

/** Instrucciones para desbloquear el permiso, según el teléfono. */
export const unblockHelp = () =>
  isIOS()
    ? 'En tu iPhone: Ajustes → Notificaciones → FamilyMarket → activa «Permitir notificaciones».'
    : 'En Android: toca el candado (o los tres puntos ⋮) junto a la dirección → Permisos → Notificaciones → Permitir.'
