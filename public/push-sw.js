// Web Push kezelés — a workbox generált service worker importScripts-en keresztül tölti be.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = {} }
  if (!data || typeof data !== 'object') data = {}
  const title = data.title || 'Alza'
  event.waitUntil(self.registration.showNotification(title, notificationOptions(data)))
})

// Az értesítés megjelenése a küldő jelzői szerint:
//  silent — hang és rezgés nélkül (a „néma” riasztás); a silent mellé rezgés NEM adható meg
//  alarm  — hangos riasztás: hosszabb rezgés, és a képernyőn marad, amíg rá nem koppintanak
//  tag    — az azonos címkéjű értesítés az előzőt váltja (hangosnál újra jelez)
function notificationOptions(data) {
  const options = {
    body: data.body || '',
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    data: { url: data.url || '/' },
  }
  if (data.silent === true) {
    options.silent = true
  } else if (data.alarm === true) {
    options.vibrate = [300, 120, 300, 120, 300, 120, 600]
    options.requireInteraction = true
  } else {
    options.vibrate = [80, 40, 80]
  }
  if (typeof data.tag === 'string' && data.tag) {
    options.tag = data.tag
    if (data.silent !== true) options.renotify = true
  }
  return options
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  let url = (event.notification.data && event.notification.data.url) || '/'
  // csak az app saját útvonala nyitható (külső oldal, „//más-oldal” nem)
  try { url = new URL(url, self.location.origin).origin === self.location.origin ? new URL(url, self.location.origin).pathname + new URL(url, self.location.origin).search : '/' } catch (e) { url = '/' }
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
