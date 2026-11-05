import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitForNewestWorker, precacheLooksBroken } from './swUpdate'

// Ál service worker: állapot + statechange esemény
function fakeWorker(state: string) {
  const listeners = new Set<() => void>()
  const w = {
    state,
    addEventListener: (_: string, fn: () => void) => { listeners.add(fn) },
    removeEventListener: (_: string, fn: () => void) => { listeners.delete(fn) },
    set(next: string) { w.state = next; listeners.forEach((l) => l()) },
  }
  return w
}
type Reg = Parameters<typeof waitForNewestWorker>[0]
const asReg = (r: { installing: unknown; waiting: unknown }) => r as unknown as Reg

describe('waitForNewestWorker — mindig a legújabb verziót aktiváljuk', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('nincs új verzió → null (sima újratöltés)', async () => {
    await expect(waitForNewestWorker(asReg({ installing: null, waiting: null }))).resolves.toBeNull()
  })
  it('csak várakozó verzió van → azt adja', async () => {
    const waiting = fakeWorker('installed')
    await expect(waitForNewestWorker(asReg({ installing: null, waiting }))).resolves.toBe(waiting)
  })
  it('régebbi várakozik ÉS újabb települ → megvárja a telepítést, és az újabbat adja (nem a régit)', async () => {
    const older = fakeWorker('installed'); const newer = fakeWorker('installing')
    const reg = { installing: newer as unknown, waiting: older as unknown }
    let got: unknown = 'még vár'
    void waitForNewestWorker(asReg(reg)).then((w) => { got = w })
    await vi.advanceTimersByTimeAsync(5000)
    expect(got).toBe('még vár') // a régebbit nem adja ki, amíg az újabb települ
    reg.installing = null; reg.waiting = newer; older.set('redundant'); newer.set('installed')
    await vi.advanceTimersByTimeAsync(0)
    expect(got).toBe(newer)
  })
  it('a telepítés elbukik (redundant) → a korábbi várakozó marad', async () => {
    const older = fakeWorker('installed'); const newer = fakeWorker('installing')
    const reg = { installing: newer as unknown, waiting: older as unknown }
    const p = waitForNewestWorker(asReg(reg))
    reg.installing = null; newer.set('redundant')
    await expect(p).resolves.toBe(older)
  })
  it('a telepítés nem ér véget időben → null: semmit nem aktiválunk a települő verzió alatt', async () => {
    const older = fakeWorker('installed'); const newer = fakeWorker('installing')
    const p = waitForNewestWorker(asReg({ installing: newer, waiting: older }), 25_000)
    await vi.advanceTimersByTimeAsync(25_000)
    await expect(p).resolves.toBeNull()
  })
})

describe('precacheLooksBroken — sérült előtöltött gyorsítótár', () => {
  const name = 'workbox-precache-v2-https://alza.szakify.hu/'
  it('ép: van gyorsítótár és benne a kezdőlap (új vagy régi néven)', () => {
    expect(precacheLooksBroken([name], ['https://alza.szakify.hu/?__WB_REVISION__=abc', 'https://alza.szakify.hu/assets/index-x.js'])).toBe(false)
    expect(precacheLooksBroken([name], ['https://alza.szakify.hu/index.html?__WB_REVISION__=abc'])).toBe(false)
  })
  it('sérült: hiányzik a kezdőlap, vagy nincs is előtöltött gyorsítótár', () => {
    expect(precacheLooksBroken([name], ['https://alza.szakify.hu/assets/index-x.js'])).toBe(true)
    expect(precacheLooksBroken(['supabase-storage'], [])).toBe(true)
    expect(precacheLooksBroken([], [])).toBe(true)
  })
})
