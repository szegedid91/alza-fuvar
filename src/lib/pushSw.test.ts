import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A service worker push-kezelője (public/push-sw.js) sima szkript — itt egy ál-`self`-fel futtatjuk,
// és azt nézzük, milyen beállításokkal jelenne meg az értesítés.
function showFor(data: unknown): { title: string; options: Record<string, unknown> } {
  const src = readFileSync(resolve(__dirname, '../../public/push-sw.js'), 'utf8')
  const handlers: Record<string, (e: unknown) => void> = {}
  let shown: { title: string; options: Record<string, unknown> } | null = null
  const self = {
    addEventListener: (name: string, fn: (e: unknown) => void) => { handlers[name] = fn },
    registration: { showNotification: (title: string, options: Record<string, unknown>) => { shown = { title, options }; return Promise.resolve() } },
  }
  new Function('self', src)(self)
  handlers.push({ data: { json: () => data }, waitUntil: () => undefined })
  if (!shown) throw new Error('nem jelent meg értesítés')
  return shown
}

describe('push-sw — az értesítés megjelenése', () => {
  it('sima értesítés: rövid rezgés, a megadott cím / szöveg / link', () => {
    const { title, options } = showFor({ title: 'Cím', body: 'Szöveg', url: '/attekintes' })
    expect(title).toBe('Cím')
    expect(options).toMatchObject({ body: 'Szöveg', data: { url: '/attekintes' }, vibrate: [80, 40, 80] })
    expect(options.silent).toBeUndefined(); expect(options.requireInteraction).toBeUndefined()
  })
  it('néma riasztás: silent, rezgés nélkül (a kettő együtt hibát dobna a böngészőben)', () => {
    const { options } = showFor({ title: 'x', silent: true, alarm: true, tag: 'setoff-1' })
    expect(options.silent).toBe(true)
    expect(options.vibrate).toBeUndefined(); expect(options.requireInteraction).toBeUndefined()
    expect(options.tag).toBe('setoff-1'); expect(options.renotify).toBeUndefined()
  })
  it('hangos riasztás: hosszú rezgés, a képernyőn marad, címkével újra jelez', () => {
    const { options } = showFor({ title: 'x', alarm: true, tag: 'setoff-1' })
    expect(options.requireInteraction).toBe(true)
    expect((options.vibrate as number[]).length).toBeGreaterThan(3)
    expect(options).toMatchObject({ tag: 'setoff-1', renotify: true })
  })
  it('hibás csomag sem akad el: alapértelmezett cím', () => {
    expect(showFor(null).title).toBe('Alza')
  })
})
