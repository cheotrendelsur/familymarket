// Notificaciones push de FamilyMarket. Lo carga el service worker de la app (workbox.importScripts en vite.config.js).
// Android y iPhone (iOS 16.4+, app instalada en la pantalla de inicio) reciben aquí cada aviso y lo muestran.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'FamilyMarket'
  // iOS exige mostrar SIEMPRE una notificación por cada push (si no, retira el permiso).
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue
        await client.focus()
        // La app abierta cambia de pantalla sin recargarse (si no escucha, se navega directo).
        client.postMessage({ type: 'fm-navigate', url: target.pathname + target.search })
        return
      }
      await self.clients.openWindow(target.href)
    })()
  )
})
