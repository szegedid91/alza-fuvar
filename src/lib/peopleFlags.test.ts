import { describe, it, expect } from 'vitest'
import { flagOf, unexcused, coversDate, type PersonSignals } from './peopleFlags'

const zero: PersonSignals = { missed: 0, lateDepartures: 0, stops: 0, lateStops: 0, alarms: 0, notParked: 0, waived: 0, warnings: 0, complaints: 0 }

describe('peopleFlags', () => {
  it('az igazolt távollét napja nem kimaradt nap', () => {
    expect(coversDate({ from_date: '2026-11-03', to_date: '2026-11-05' }, '2026-11-05')).toBe(true)
    expect(unexcused(['2026-11-02', '2026-11-04', '2026-11-09'], [{ from_date: '2026-11-03', to_date: '2026-11-05' }])).toEqual(['2026-11-02', '2026-11-09'])
  })
  it('nincs eltérés → nincs jel', () => {
    expect(flagOf(zero)).toEqual({ level: null, reasons: [], score: 0 })
    // kevés megállónál a késési arány még nem mond semmit
    expect(flagOf({ ...zero, stops: 5, lateStops: 5 }).level).toBeNull()
  })
  it('sárga és piros okok, a piros mindig előrébb rendez', () => {
    const y = flagOf({ ...zero, missed: 1, lateDepartures: 2, stops: 20, lateStops: 5, notParked: 1 })
    expect(y.level).toBe('yellow')
    expect(y.reasons).toEqual(['1 kimaradt nap', '2 késett indulás', 'a megállók 25%-a késett', '1 napon nem rakta le az autót'])
    const r = flagOf({ ...zero, alarms: 1 })
    expect(r.level).toBe('red')
    expect(r.score).toBeGreaterThan(y.score)
    expect(flagOf({ ...zero, missed: 2, lateDepartures: 3, complaints: 1, warnings: 1 }).reasons).toEqual(['2 kimaradt nap', '3 késett indulás', '1 megbízói panasz', '1 figyelmeztetés'])
  })
})
