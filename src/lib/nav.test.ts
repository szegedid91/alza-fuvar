import { describe, expect, it, vi } from 'vitest'
import { navTargetOf, navUrl, openNav, shouldNavAfterFill, type AfterFill } from './nav'

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
    expect(openNav({ lat: 47.5, lng: 19.05 }, { open, app: 'waze', auto: true })).toBe(true)
    expect(open).toHaveBeenCalledWith('https://waze.com/ul?ll=47.5,19.05&navigate=yes')
    expect(openNav({ lat: 47.5, lng: 19.05 }, { open, app: 'google', auto: false })).toBe(false)
    expect(openNav(null, { open, app: 'google', auto: true })).toBe(false)
    expect(open).toHaveBeenCalledTimes(1)
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
