import { describe, expect, it, vi } from 'vitest'
import { canFinishRouteFromSheet, clearNavPrompt, launchNav, navPromptDest, navPromptPending, navSchemeUrl, navTargetOf, navUrl, openNav, requestNavPrompt, shouldNavAfterFill, type AfterFill } from './nav'

describe('navigáció koordinátára', () => {
  it('a cél mindig a koordináta, és a navigáció rögtön indul', () => {
    expect(navUrl('google', 47.5123, 19.0456)).toBe('https://www.google.com/maps/dir/?api=1&destination=47.5123,19.0456&travelmode=driving&dir_action=navigate')
    expect(navUrl('waze', 47.5123, 19.0456)).toBe('https://waze.com/ul?ll=47.5123,19.0456&navigate=yes')
  })
  it('hiányzó vagy értelmetlen koordinátára nincs cél', () => {
    expect(navTargetOf({ lat: 47.5, lng: 19.05 })).toEqual({ lat: 47.5, lng: 19.05 })
    expect(navTargetOf({ lat: null, lng: 19.05 })).toBeNull()
    expect(navTargetOf({ lat: 0, lng: 0 })).toBeNull()
    expect(navTargetOf({ lat: 147.5, lng: 19.05 })).toBeNull()
    expect(navTargetOf(null)).toBeNull()
  })
  it('bekapcsolt automatikánál megnyitja a választott appot; kikapcsolva vagy cél nélkül nem', () => {
    const open = vi.fn()
    expect(openNav({ lat: 47.5, lng: 19.05 }, { open, phone: false, app: 'waze', auto: true })).toBe(true)
    expect(open).toHaveBeenCalledWith('https://waze.com/ul?ll=47.5,19.05&navigate=yes')
    expect(openNav({ lat: 47.5, lng: 19.05 }, { open, phone: false, app: 'google', auto: false })).toBe(false)
    expect(openNav(null, { open, phone: false, app: 'google', auto: true })).toBe(false)
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('telefonon az app saját sémájával indul, ugyanazon a lapon — új böngészőlap nem nyílik', () => {
    const go = vi.fn(); const open = vi.fn()
    expect(openNav({ lat: 47.5, lng: 19.05 }, { go, open, phone: true, ios: false, app: 'waze', auto: true })).toBe(true)
    expect(go).toHaveBeenCalledWith('waze://?ll=47.5,19.05&navigate=yes')
    expect(launchNav('google', 47.5, 19.05, { go, open, phone: true, ios: false })).toBe(true)
    expect(go).toHaveBeenLastCalledWith('google.navigation:q=47.5,19.05&mode=d')
    expect(launchNav('google', 47.5, 19.05, { go, open, phone: true, ios: true })).toBe(true)
    expect(go).toHaveBeenLastCalledWith('comgooglemaps://?daddr=47.5,19.05&directionsmode=driving')
    expect(open).not.toHaveBeenCalled()
  })
  it('a séma is koordinátára megy', () => {
    expect(navSchemeUrl('waze', 47.5123, 19.0456, true)).toBe('waze://?ll=47.5123,19.0456&navigate=yes')
    expect(navSchemeUrl('google', 47.5123, 19.0456, false)).toBe('google.navigation:q=47.5123,19.0456&mode=d')
  })
})

describe('navigáció a Box-lap „Kész, következő box” gombjáról', () => {
  const after: AfterFill = { boxId: 'b1', nav: { lat: 47.5, lng: 19.05 }, deadline: '10:00', carryKey: 'late-carry:R:1' }
  it('időben: a következő box koordinátájára megy', () => {
    expect(shouldNavAfterFill(after, 'b1', { lateMin: () => null })).toEqual({ lat: 47.5, lng: 19.05 })
    expect(shouldNavAfterFill(after, 'b1', { lateMin: () => 0 })).toEqual({ lat: 47.5, lng: 19.05 })
  })
  it('késésben, ok nélkül: előbb az okot kéri a járat-kártya — itt nem indul', () => {
    expect(shouldNavAfterFill(after, 'b1', { lateMin: () => 12, hasCarry: () => false })).toBeNull()
  })
  it('késésben, de az ok már megvan a körre: indul', () => {
    expect(shouldNavAfterFill(after, 'b1', { lateMin: () => 12, hasCarry: () => true })).toEqual({ lat: 47.5, lng: 19.05 })
  })
  it('másik boxra szóló vagy cél nélküli átadásnál nem indul', () => {
    expect(shouldNavAfterFill(after, 'b2', { lateMin: () => null })).toBeNull()
    expect(shouldNavAfterFill({ ...after, nav: null }, 'b1', { lateMin: () => null })).toBeNull()
    expect(shouldNavAfterFill(null, 'b1')).toBeNull()
  })
})

describe('navigáció a „Kiindultam” után', () => {
  it('a jelzés után 15 percig vár a „Navigáció indítása” — indítás vagy bezárás után eltűnik', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
    expect(navPromptPending(1000)).toBe(false)
    requestNavPrompt(null, 1000)
    expect(navPromptPending(1000 + 60_000)).toBe(true)
    expect(navPromptPending(1000 + 16 * 60_000)).toBe(false)
    clearNavPrompt()
    expect(navPromptPending(2000)).toBe(false)
    vi.unstubAllGlobals()
  })
  it('kikapcsolt automatikus navigációnál nem kér indítást', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'alza-nav-auto' ? '0' : null), setItem: () => undefined, removeItem: () => undefined })
    requestNavPrompt(null, 1000)
    expect(navPromptPending(2000)).toBe(false)
    vi.unstubAllGlobals()
  })
})

describe('„Járat kész” a Box-lapról', () => {
  const after: AfterFill = { boxId: 'b9', nav: null, deadline: '10:00', carryKey: 'late-carry:R:1', routeCode: 'R', depot: { lat: 47.48, lng: 19.19, title: 'Raktár', address: 'Budapest' } }
  it('az utolsó boxnál a lap gombja zárhatja a járatot, ha nem kell előbb késés-ok', () => {
    expect(canFinishRouteFromSheet(after, 'b9', { lateMin: () => null })).toBe(true)
    expect(canFinishRouteFromSheet(after, 'b9', { lateMin: () => 20, hasCarry: () => true })).toBe(true)
    expect(canFinishRouteFromSheet(after, 'b9', { lateMin: () => 20, hasCarry: () => false })).toBe(false)
    expect(canFinishRouteFromSheet(after, 'másik', { lateMin: () => null })).toBe(false)
    expect(canFinishRouteFromSheet(null, 'b9')).toBe(false)
  })
  it('a raktárhoz kért indítás külön van a járat címéhez kérttől', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
    requestNavPrompt(after.depot, 1000)
    expect(navPromptDest(2000)).toEqual({ lat: 47.48, lng: 19.19, title: 'Raktár', address: 'Budapest' })
    expect(navPromptPending(2000)).toBe(false)
    expect(navPromptDest(1000 + 16 * 60_000)).toBeNull()
    requestNavPrompt(null, 3000)
    expect(navPromptPending(4000)).toBe(true)
    expect(navPromptDest(4000)).toBeNull()
    vi.unstubAllGlobals()
  })
})
