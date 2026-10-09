// Actualización de la app instalada (PWA) sin interrumpir a nadie: cuando hay una
// versión nueva se avisa con un banner y se aplica SOLO cuando el jugador toca
// "Actualizar" (así un despliegue nunca recarga la pantalla en medio de una compra).

let updateSW = null
let needRefresh = false
const listeners = new Set()

export function initPWA() {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          needRefresh = true
          listeners.forEach((fn) => fn(true))
        },
        onRegisteredSW(_url, registration) {
          // Busca versiones nuevas cada 30 min mientras la app está abierta.
          if (registration) setInterval(() => registration.update().catch(() => {}), 30 * 60 * 1000)
        },
      })
    })
    .catch(() => {})
}

export function subscribeUpdate(fn) {
  listeners.add(fn)
  if (needRefresh) fn(true)
  return () => listeners.delete(fn)
}

export const applyUpdate = () => (updateSW ? updateSW(true) : window.location.reload())
