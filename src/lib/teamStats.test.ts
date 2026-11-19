import { describe, it, expect } from 'vitest'
import { perPersonMetrics, compareToTeam, type TeamInputs, type Metrics } from './teamStats'
import type { PShift, PCheckin } from './personStats'

const sh = (date: string, user: string, o: Partial<PShift> = {}): PShift => ({ work_date: date, workspace_id: 'w', car_id: `car-${user}`, round: 1, is_box: false, driver_id: user, loader_id: null, trainee_id: null, plate: user.toUpperCase(), route: null, ...o })
const ci = (date: string, user: string, hours: number | null): PCheckin => ({ user_id: user, work_date: date, workspace_id: 'w', first_checked_in_at: `${date}T06:00:00Z`, checked_in_at: `${date}T06:00:00Z`, checked_out_at: hours == null ? null : new Date(new Date(`${date}T06:00:00Z`).getTime() + hours * 3_600_000).toISOString(), outside_geofence: false, out_outside_geofence: false, prev_car_id: null })
const empty: TeamInputs = { shifts: [], checkins: [], departed: [], logs: [], sheetStops: [], xl: [], absences: [] }

describe('perPersonMetrics', () => {
  it('napok, XL átlag, munkaidő és kimaradt nap — csak ahol van elég adat', () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']
    const t: TeamInputs = {
      ...empty,
      shifts: [...days.map((d) => sh(d, 'a')), sh('2026-11-02', 'b'), sh('2026-11-30', 'a')],
      checkins: [ci('2026-11-02', 'a', 8), ci('2026-11-03', 'a', 10), ci('2026-11-04', 'a', 9)],
      xl: days.slice(0, 3).map((d, i) => ({ car_id: 'car-a', work_date: d, success_count: 10 + i * 2 })),
      absences: [],
    }
    const m = perPersonMetrics(t, '2026-11-20')
    expect(m.get('a')).toMatchObject({ days: 4, xlAvg: 12, hours: 9, missed: 1 })
    // b: egy nap, becsekkolás nélkül → nincs munkaidő, XL átlag és kimaradt nap sem (nem csekkol be)
    expect(m.get('b')).toEqual({ days: 1 })
    // igazolt távollét: a kimaradt nap nem számít
    const m2 = perPersonMetrics({ ...t, absences: [{ user_id: 'a', from_date: '2026-11-05', to_date: '2026-11-05' }] }, '2026-11-20')
    expect(m2.get('a')?.missed).toBe(0)
  })
  it('kevés megállónál nincs késési arány', () => {
    const logs = Array.from({ length: 9 }, (_, i) => ({ user_id: 'a', work_date: '2026-11-02', route_id: 'r', round: 1, done_at: new Date(2026, 10, 2, 1, i * 5).toISOString(), late_minutes: 3, delay_reason: null }))
    expect(perPersonMetrics({ ...empty, shifts: [sh('2026-11-02', 'a')], logs }, '2026-11-20').get('a')?.lateStopPct).toBeUndefined()
    const more = [...logs, { ...logs[0], done_at: new Date(2026, 10, 2, 2, 0).toISOString(), late_minutes: 0 }]
    expect(perPersonMetrics({ ...empty, shifts: [sh('2026-11-02', 'a')], logs: more }, '2026-11-20').get('a')?.lateStopPct).toBe(90)
  })
})

describe('compareToTeam', () => {
  const all = new Map<string, Metrics>([
    ['a', { days: 20, lateStopPct: 10, xlAvg: 15 }], ['b', { days: 10, lateStopPct: 30 }], ['c', { days: 20, lateStopPct: 20 }], ['d', {}],
  ])
  it('átlag és helyezés; a kisebb a jobb mutatónál fordított a sorrend', () => {
    const rows = compareToTeam(all, 'a')
    expect(rows.find((r) => r.key === 'days')).toMatchObject({ mine: 20, rank: 1, of: 3, lowerIsBetter: false })
    expect(rows.find((r) => r.key === 'days')!.avg).toBeCloseTo(50 / 3)
    expect(rows.find((r) => r.key === 'lateStopPct')).toMatchObject({ mine: 10, avg: 20, rank: 1, of: 3, lowerIsBetter: true })
    // XL átlaga csak neki van: nincs kihez mérni
    expect(rows.some((r) => r.key === 'xlAvg')).toBe(false)
    expect(compareToTeam(all, 'b').find((r) => r.key === 'lateStopPct')).toMatchObject({ rank: 3 })
    // azonos érték azonos helyezés
    expect(compareToTeam(all, 'c').find((r) => r.key === 'days')).toMatchObject({ rank: 1 })
  })
  it('adat nélküli vagy ismeretlen embernél üres', () => {
    expect(compareToTeam(all, 'd')).toEqual([])
    expect(compareToTeam(all, 'x')).toEqual([])
  })
})
