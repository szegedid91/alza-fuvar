import { describe, it, expect, vi, afterEach } from 'vitest'

const deleted: string[] = []
let deleteFails = false
vi.mock('./supabase', () => ({
  supabase: { from: () => ({ delete: () => ({ eq: (_c: string, endpoint: string) => { if (deleteFails) return Promise.reject(new Error('offline')); deleted.push(endpoint); return Promise.resolve({ error: null }) } }) }) },
}))

function stubBrowser(reg: unknown) {
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: () => Promise.resolve(reg), ready: new Promise(() => undefined) } })
  vi.stubGlobal('window', { PushManager: function PushManager() { /* jelenlét-ellenőrzéshez */ }, Notification: function Notification() { /* jelenlét-ellenőrzéshez */ } })
  vi.stubGlobal('PushManager', function PushManager() { /* jelenlét-ellenőrzéshez */ })
  vi.stubGlobal('Notification', function Notification() { /* jelenlét-ellenőrzéshez */ })
}
afterEach(() => { vi.unstubAllGlobals(); deleted.length = 0; deleteFails = false })

describe('unsubscribePush — kijelentkezéskor', () => {
  it('service worker nélkül azonnal visszatér (nem vár a soha nem teljesülő .ready-re)', async () => {
    stubBrowser(undefined)
    const { unsubscribePush } = await import('./push')
    const done = await Promise.race([unsubscribePush().then(() => 'kész'), new Promise((r) => setTimeout(() => r('elakadt'), 300))])
    expect(done).toBe('kész')
  })
  it('SEC-03: a böngésző-feliratkozás akkor is megszűnik, ha a DB-sor törlése elhasal', async () => {
    let unsubscribed = 0
    stubBrowser({ pushManager: { getSubscription: () => Promise.resolve({ endpoint: 'https://push.example/abc', unsubscribe: () => { unsubscribed++; return Promise.resolve(true) } }) } })
    const { unsubscribePush } = await import('./push')
    await unsubscribePush()
    expect(deleted).toEqual(['https://push.example/abc']); expect(unsubscribed).toBe(1)
    deleteFails = true
    await unsubscribePush()
    expect(unsubscribed).toBe(2)
  })
})
