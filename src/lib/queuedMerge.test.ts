import { describe, expect, it } from 'vitest'
import { isStopFilled, mergeQueuedRuns, mergeQueuedStops, type QueuedRec } from './queuedMerge'
import type { BoxStop } from './boxSheet'

const stop = (id: string, over: Partial<BoxStop> = {}): BoxStop => ({
  id, sheet_id: 's1', workspace_id: 'w', seq: 1, created_at: '', done_at: null, box_id: 'b-' + id, box_code: 'AB' + id, box_name: null, note: null,
  placed: 0, missorted: 0, nf: 0, oversize: 0, shortage: 0, returned: 0, damaged: 0, invalid_code: 0, do_not_place: 0, cancelled: 0, left_on_car: 0, ...over,
})
const q = (over: Partial<QueuedRec>): QueuedRec => ({ table: 'box_sheet_stops', op: 'insert', values: {}, createdAt: 1, ...over })

describe('mergeQueuedStops', () => {
  it('a sorban álló felvétel megjelenik, a sorban álló módosítás rákerül — időrendben', () => {
    const out = mergeQueuedStops([stop('1', { placed: 5 })], [
      q({ op: 'update', match: { id: '2' }, values: { placed: 9 }, createdAt: 3 }),
      q({ values: { id: '2', sheet_id: 's1', workspace_id: 'w', box_id: 'bx', box_code: 'AB2' }, createdAt: 2 }),
      q({ op: 'update', match: { id: '1' }, values: { nf: 1 }, createdAt: 4 }),
    ], 's1')
    expect(out.map((s) => [s.id, s.placed, s.nf])).toEqual([['1', 5, 1], ['2', 9, 0]])
    expect(out[1].box_code).toBe('AB2')
  })
  it('más lap felvétele nem kerül ide; ami már a szerveren van, nem duplázódik; más tábla nem számít', () => {
    const out = mergeQueuedStops([stop('1')], [
      q({ values: { id: '9', sheet_id: 'masik' } }),
      q({ values: { id: '1', sheet_id: 's1' } }),
      q({ table: 'route_runs', values: { id: 'x', sheet_id: 's1' } }),
    ], 's1')
    expect(out.map((s) => s.id)).toEqual(['1'])
    expect(mergeQueuedStops([], [q({ values: { id: '9', sheet_id: 'masik' } })], null).map((s) => s.id)).toEqual(['9'])
  })
})

describe('isStopFilled', () => {
  it('szám vagy megjegyzés kell', () => {
    expect(isStopFilled(stop('1'))).toBe(false)
    expect(isStopFilled(stop('1', { placed: 3 }))).toBe(true)
    expect(isStopFilled(stop('1', { nf: 1 }))).toBe(true)
    expect(isStopFilled(stop('1', { note: 'Box-hiba: Nem nyílik a fiók' }))).toBe(true)
    expect(isStopFilled(stop('1', { note: '  ' }))).toBe(false)
  })
})

describe('mergeQueuedRuns', () => {
  const run = { route_id: 'r', round: 1, car_id: 'c', current_index: 2, current_stop_id: null, current_box_id: null }
  it('a sorban álló léptetés felülírja az állást, az utolsó nyer; más nap nem számít', () => {
    const out = mergeQueuedRuns([run], [
      q({ table: 'route_runs', values: { work_date: '2026-11-15', route_id: 'r', round: 1, car_id: 'c', current_index: 3 }, createdAt: 1 }),
      q({ table: 'route_runs', values: { work_date: '2026-11-15', route_id: 'r', round: 1, car_id: 'c', current_index: 4, current_box_id: 'b4' }, createdAt: 2 }),
      q({ table: 'route_runs', values: { work_date: '2026-11-14', route_id: 'r', round: 1, car_id: 'c', current_index: 9 }, createdAt: 3 }),
      q({ table: 'route_runs', values: { work_date: '2026-11-15', route_id: 'r2', round: 2, car_id: 'c', current_index: 0 }, createdAt: 4 }),
    ], '2026-11-15')
    expect(out).toEqual([{ ...run, current_index: 4, current_box_id: 'b4' }, { route_id: 'r2', round: 2, car_id: 'c', current_index: 0, current_stop_id: null, current_box_id: null }])
  })
})
