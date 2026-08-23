// Web Push kezelés — a workbox generált service worker importScripts-en keresztül tölti be.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = {} }
  const title = data.title || 'Alza'
  const options = {
    body: data.body || '',
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    data: { url: data.url || '/' },
    vibrate: [80, 40, 80],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Előny: már a cél-útvonalon nyitva lévő ablak; különben a meglévő ablakot
      // navigáljuk az értesítés linkjére — csak fókuszálni nem elég.
      for (const client of list) {
        const path = new URL(client.url).pathname
        if (path === url && 'focus' in client) return client.focus()
      }
      for (const client of list) {
        if ('navigate' in client && 'focus' in client) {
          return client.navigate(url).then((c) => (c ? c.focus() : undefined)).catch(() => client.focus())
        }
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    }),
  )
})
