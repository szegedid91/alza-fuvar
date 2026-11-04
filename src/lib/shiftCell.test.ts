import { describe, it, expect } from 'vitest'
import { nextShiftValues, isEmptyShift } from './shiftCell'

describe('nextShiftValues — a cella módosítása a friss szerver-sor alapján (LOG-07)', () => {
  it('a szerveren közben beírt sofőr megmarad, ha a másik vezető a rakodót állítja', () => {
    const server = { driver_id: 'anna', loader_id: null, trainee_id: null, route_id: null }
    expect(nextShiftValues(server, 'loader_id', 'bela')).toEqual({ driver_id: 'anna', loader_id: 'bela', trainee_id: null, route_id: null })
  })
  it('üres érték törli a mezőt; extra felülír (pl. csere)', () => {
    const server = { driver_id: 'anna', loader_id: 'bela', trainee_id: null, route_id: 'r1' }
    expect(nextShiftValues(server, 'driver_id', '')).toEqual({ driver_id: null, loader_id: 'bela', trainee_id: null, route_id: 'r1' })
    expect(nextShiftValues(server, 'driver_id', 'bela', { loader_id: 'anna' })).toEqual({ driver_id: 'bela', loader_id: 'anna', trainee_id: null, route_id: 'r1' })
  })
  it('nincs sor → csak a beírt mező', () => {
    expect(nextShiftValues(null, 'trainee_id', 'cili')).toEqual({ driver_id: null, loader_id: null, trainee_id: 'cili', route_id: null })
  })
  it('isEmptyShift: csak személy számít, a járat nem tart meg üres sort', () => {
    expect(isEmptyShift({ driver_id: null, loader_id: null, trainee_id: null, route_id: 'r1' })).toBe(true)
    expect(isEmptyShift({ driver_id: null, loader_id: 'x', trainee_id: null, route_id: null })).toBe(false)
  })
})
