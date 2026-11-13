import { describe, expect, it } from 'vitest'
import { findBoxInRoutes, routeKm, routeLegs } from './routeLookup'
import type { AlzaBox } from './boxSheet'

const box = (id: string, code: string, name: string): AlzaBox => ({ id, code, name, address: null, lat: null, lng: null, description: null, notes: null, image_url: null, updated_at: '', last_seen_at: null, active: true } as unknown as AlzaBox)

describe('findBoxInRoutes', () => {
  it('melyik járat hanyadik címe; csak a járatainkon lévő boxok közt keres', () => {
    const boxes = [box('1', 'AB9001', 'Pomáz'), box('2', 'AB9002', 'Pomáz Fő tér'), box('3', 'AB9003', 'Pilis')]
    const routes = [{ id: 'r', code: 'R' }, { id: 'g', code: 'G' }]
    const stops = { r: [{ box_id: '3', eta: '06:00:00', deadline: null }, { box_id: '2', eta: '06:20:00', deadline: '10:00:00' }], g: [{ box_id: '2', eta: null, deadline: null }] }
    const hits = findBoxInRoutes(boxes, routes, stops, 'pomáz')
    expect(hits.map((h) => h.box.code)).toEqual(['AB9002'])
    expect(hits[0].placements).toEqual([{ route: 'R', index: 2, total: 2, eta: '06:20:00', deadline: '10:00:00' }, { route: 'G', index: 1, total: 1, eta: null, deadline: null }])
  })
})

describe('routeLegs', () => {
  it('raktár → boxok → raktár, hiányzó koordinátával', () => {
    const dist = (a: number, b: number, c: number, d: number) => Math.abs(a - c) * 1000 + Math.abs(b - d) * 1000
    const r = routeLegs([{ lat: 1, lng: 0 }, { lat: 1, lng: 2 }, { lat: null, lng: null }, { lat: 0, lng: 2 }], { lat: 0, lng: 0 }, dist)
    expect(r.legs).toEqual([1000, 2000, null, null])
    expect(r.back).toBe(2000)
    expect(r.total).toBe(5000)
    expect(r.missing).toBe(2)
  })
})

describe('routeKm', () => {
  it('a koordináta nélküli boxot kihagyja, és számolja, hány maradt ki', () => {
    const dist = (a: number, b: number, c: number, d: number) => Math.abs(a - c) * 1000 + Math.abs(b - d) * 1000
    expect(routeKm([{ lat: 1, lng: 0 }, { lat: null, lng: null }, { lat: 1, lng: 2 }], { lat: 0, lng: 0 }, dist)).toEqual({ km: 6, missing: 1 })
    expect(routeKm([{ lat: null, lng: null }], { lat: 0, lng: 0 }, dist)).toBeNull()
  })
})
