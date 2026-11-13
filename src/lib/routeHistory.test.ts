import { describe, expect, it } from 'vitest'
import { diffUploads, groupUploads, type PlanVersion } from './routeHistory'

const v = (id: string, code: string, at: string, codes: string[], source = 'a.xlsx', start: string | null = '05:30:00', eta?: Record<string, string>): PlanVersion => ({
  id, route_id: null, code, source, imported_at: at, imported_by: null, planned_start: start, planned_end: null,
  stops: codes.map((c) => ({ box_id: null, code: c, name: null, eta: eta?.[c] ?? null, etd: null, deadline: null })),
})

describe('groupUploads', () => {
  it('az egy fájlból, időben közel betöltött járatok egy feltöltés', () => {
    const u = groupUploads([
      v('1', 'R', '2026-11-13T07:37:56Z', ['A']), v('2', 'G', '2026-11-13T07:37:55Z', ['B']),
      v('3', 'R', '2026-10-30T13:37:58Z', ['A'], 'b.xlsx'), v('4', 'G', '2026-10-30T13:37:57Z', ['B'], 'b.xlsx'),
    ])
    expect(u.map((x) => [x.source, x.routes.map((r) => r.code).join('')])).toEqual([['b.xlsx', 'GR'], ['a.xlsx', 'GR']])
  })
})

describe('diffUploads', () => {
  it('új, lekerült, áthelyezett, sorrend és idő', () => {
    const prev = groupUploads([v('1', 'R', '2026-10-30T13:00:00Z', ['A', 'B', 'C'], 'p', '05:30:00', { A: '06:00:00' }), v('2', 'G', '2026-10-30T13:00:01Z', ['D', 'E'], 'p')])[0]
    const cur = groupUploads([v('3', 'R', '2026-11-13T07:00:00Z', ['B', 'A', 'D', 'X'], 'c', '05:00:00', { A: '06:15:00' }), v('4', 'G', '2026-11-13T07:00:01Z', ['E'], 'c'), v('5', 'J', '2026-11-13T07:00:02Z', ['Y'], 'c')])[0]
    const d = diffUploads(prev, cur)
    const r = d.routes.find((x) => x.code === 'R')!
    expect(r.added).toEqual([{ code: 'D', from: 'G' }, { code: 'X', from: null }])
    expect(r.removed).toEqual([{ code: 'C', to: null }])
    expect(r.reordered).toBe(2)
    expect(r.etaShifts).toEqual([{ code: 'A', from: '06:00:00', to: '06:15:00', minutes: 15 }])
    expect(r.startFrom).toBe('05:30:00'); expect(r.startTo).toBe('05:00:00')
    expect(d.routes.find((x) => x.code === 'G')!.removed).toEqual([{ code: 'D', to: 'R' }])
    expect(d.routes.find((x) => x.code === 'J')!.status).toBe('new')
    expect(d.totals).toEqual({ boxes: 6, prevBoxes: 5, added: 2, removed: 1, moved: 1, reordered: 2, etaChanged: 1 })
  })
  it('első feltöltésnél minden box új, előzmény nélkül', () => {
    const cur = groupUploads([v('1', 'R', '2026-10-28T13:00:00Z', ['A', 'B'], 'első')])[0]
    const d = diffUploads(null, cur)
    expect(d.routes[0].status).toBe('new'); expect(d.totals.added).toBe(2)
  })
})
