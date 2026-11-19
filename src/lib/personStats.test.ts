import { describe, it, expect } from 'vitest'
import { monthsOf, rateResolver, buildMonthRows, dailyHours, monthlyAvgHours, carDays, xlSeries, attendance, type PShift, type PCheckin } from './personStats'

const U = 'u1'
const rate = (d: number, l: number, extra: object = {}) => ({ driver_day_rate: d, loader_day_rate: l, trainee_day_rate: 0, box_day_rate: 22000, box_trainee_day_rate: 0, box_round2_day_rate: 10000, ...extra })
const sh = (date: string, o: Partial<PShift> = {}): PShift => ({ work_date: date, workspace_id: 'w', car_id: 'c1', round: 1, is_box: false, driver_id: U, loader_id: null, trainee_id: null, plate: 'AAA-111', route: null, ...o })
const ci = (date: string, from: string, to: string | null): PCheckin => ({ user_id: U, work_date: date, workspace_id: 'w', first_checked_in_at: from, checked_in_at: from, checked_out_at: to, outside_geofence: false, out_outside_geofence: false, prev_car_id: null })

describe('monthsOf', () => {
  it('a kezdettől a (kizáró) végig, évváltáson át is', () => {
    expect(monthsOf('2026-11-01', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(monthsOf('2026-11-01', '2026-12-01')).toEqual(['2026-11'])
    expect(monthsOf('2026-11-01', '2026-11-01')).toEqual([])
  })
})

describe('rateResolver', () => {
  it('a hónap kezdetéig hatályos utolsó díjsor; díjsor nélkül a munkaterület jelenlegi díja', () => {
    const of = rateResolver([{ id: 'w', ...rate(30000, 25000) }], [
      { workspace_id: 'w', valid_from: '2026-11-01', ...rate(27000, 22000, { xl_bonus_over: 20, xl_bonus_amount: 3000 }) },
      { workspace_id: 'w', valid_from: '2026-09-01', ...rate(25000, 20000) },
      { workspace_id: 'masik', valid_from: '2026-01-01', ...rate(1, 1) },
    ])
    expect(of('w', '2026-08')?.driver).toBe(30000)
    expect(of('w', '2026-10')?.driver).toBe(25000)
    expect(of('w', '2026-11')).toMatchObject({ driver: 27000, xlBonusOver: 20, xlBonus: 3000 })
    expect(of('nincs', '2026-11')).toBeUndefined()
  })
})

describe('buildMonthRows', () => {
  const rateOf = rateResolver([{ id: 'w', ...rate(25000, 20000) }], [
    { workspace_id: 'w', valid_from: '2026-11-01', ...rate(27000, 22000, { xl_bonus_over: 20, xl_bonus_amount: 3000 }) },
  ])
  const shifts = [
    sh('2026-10-30'), sh('2026-11-02'), sh('2026-11-03', { loader_id: U, driver_id: 'x' }),
    sh('2026-11-04', { is_box: true, car_id: 'b1', plate: 'BOX-1' }), sh('2026-11-04', { is_box: true, car_id: 'b1', plate: 'BOX-1', round: 2 }),
    sh('2026-11-28'),
  ]
  const base = { userId: U, months: ['2026-10', '2026-11'], today: '2026-11-20', shifts, rateOf, checkins: [] as PCheckin[],
    xlResults: [{ car_id: 'c1', work_date: '2026-11-02', success_count: 21 }, { car_id: 'c1', work_date: '2026-11-03', success_count: 20 }],
    adjustments: [{ type: 'advance', amount: 10000, work_date: '2026-11-10', paid_on: null, reason: null }, { type: 'deduction', amount: 2000, work_date: '2026-11-11', paid_on: null, reason: 'kár' }] }

  it('beosztás alapján: havonta az akkor érvényes díjjal, sikerdíjjal, a jövőbeli nap külön', () => {
    const [oct, nov] = buildMonthRows({ ...base, basis: 'schedule' })
    expect(oct).toMatchObject({ days: 1, xlDays: 1, base: 25000, xlPay: 25000, boxPay: 0 })
    // nov: 02. sofőr 27 000 + sikerdíj 3 000 (21 > 20); 03. rakodó 22 000 (20 nem több 20-nál); 04. Box 22 000 + 2. kör 10 000
    expect(nov).toMatchObject({ days: 3, xlDays: 2, boxDays: 1, bonusDays: 1, bonusPay: 3000, xlPay: 49000, boxPay: 32000, base: 84000, futureDays: 1 })
    expect(nov).toMatchObject({ advances: 10000, deductions: 2000, payout: 72000 })
  })
  it('becsekkolás alapján csak a becsekkolt nap fizet', () => {
    const [, nov] = buildMonthRows({ ...base, basis: 'checkin', checkins: [ci('2026-11-02', '2026-11-02T06:00:00Z', '2026-11-02T15:00:00Z')] })
    expect(nov).toMatchObject({ days: 1, base: 30000, futureDays: 0 })
  })
})

describe('munkaidő, autók, XL, jelenlét', () => {
  it('napi munkaidő az első becsekkolástól az utolsó kijelentkezésig; nyitott nap kimarad', () => {
    const h = dailyHours([ci('2026-11-02', '2026-11-02T06:00:00Z', '2026-11-02T10:00:00Z'), ci('2026-11-02', '2026-11-02T10:05:00Z', '2026-11-02T15:00:00Z'), ci('2026-11-03', '2026-11-03T06:00:00Z', null)])
    expect(h.get('2026-11-02')).toBe(9)
    expect(h.has('2026-11-03')).toBe(false)
    expect(monthlyAvgHours(['2026-10', '2026-11'], h)).toEqual([{ ym: '2026-10', avg: null, days: 0 }, { ym: '2026-11', avg: 9, days: 1 }])
  })
  it('autók napjai a mai napig, XL címszámok csak sofőrként / rakodóként', () => {
    const shifts = [sh('2026-11-02'), sh('2026-11-03'), sh('2026-11-04', { car_id: 'c2', plate: 'BBB-222' }), sh('2026-11-30'),
      sh('2026-11-05', { driver_id: 'x', trainee_id: U }), sh('2026-11-06', { is_box: true })]
    expect(carDays(shifts, '2026-11-20')).toEqual([{ plate: 'AAA-111', days: 4 }, { plate: 'BBB-222', days: 1 }])
    const res = ['02', '04', '05', '06'].map((d) => ({ car_id: d === '04' ? 'c2' : 'c1', work_date: `2026-11-${d}`, success_count: Number(d) + 10 }))
    expect(xlSeries(shifts, res, U, '2026-11-20')).toEqual([{ date: '2026-11-02', count: 12, plate: 'AAA-111' }, { date: '2026-11-04', count: 14, plate: 'BBB-222' }])
  })
  it('jelenlét: a beosztott, de be nem csekkolt korábbi napok a kimaradtak', () => {
    const a = attendance([sh('2026-11-02'), sh('2026-11-03'), sh('2026-11-20'), sh('2026-11-25')], [ci('2026-11-02', '2026-11-02T06:00:00Z', null)], '2026-11-20')
    expect(a).toEqual({ assigned: 3, worked: 1, missed: ['2026-11-03'] })
  })
})
