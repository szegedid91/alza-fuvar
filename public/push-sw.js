// Web Push kezelés — a workbox generált service worker importScripts-en keresztül tölti be.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = {} }
  if (!data || typeof data !== 'object') data = {}
  const title = data.title || 'Utód'
  const shown = self.registration.showNotification(title, notificationOptions(data))
  // Riasztásnál a nyitva lévő app is azonnal megtudja (nem a következő lekérdezéskor): ott villogó,
  // csipogó riasztó-képernyő jelenik meg
  const notifyOpenApp = data.alarm === true && self.clients && self.clients.matchAll
    ? self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((list) => { for (const c of list) { try { c.postMessage({ type: 'setoff-alarm' }) } catch (e) { /* bezárt ablak */ } } })
        .catch(() => undefined)
    : Promise.resolve()
  event.waitUntil(Promise.all([shown, notifyOpenApp]))
})

// Az értesítés megjelenése a küldő jelzői szerint:
//  silent — hang és rezgés nélkül (a „néma” riasztás); a silent mellé rezgés NEM adható meg
//  alarm  — riasztás: hosszú rezgés, a képernyőn marad, amíg rá nem koppintanak; a szerver
//           20 mp-enként újraküldi, amíg az appot meg nem nyitják (a címke miatt mindig újra szól)
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
    options.vibrate = [600, 200, 600, 200, 600, 200, 600, 200, 600, 200, 1200]
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
