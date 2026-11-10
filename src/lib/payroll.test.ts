import { describe, it, expect } from 'vitest'
import { monthRange, currentYm, sumAdvances, buildDayComps, payForDay, advanceCoverage, advanceLimitError, advanceDays, defaultDateForMonth, accountingDate, payrollDays, xlPayOf, boxPayOf } from './payroll'

describe('monthRange', () => {
  it('hónap eleje és a következő hónap eleje (kizáró vég)', () => {
    const r = monthRange('2026-10')
    expect(r.start).toBe('2026-10-01')
    expect(r.endExclusive).toBe('2026-11-01')
  })
  it('decemberből a következő évbe lép át', () => {
    const r = monthRange('2026-12')
    expect(r.endExclusive).toBe('2027-01-01')
  })
  it('a timestamptz-szűrő a HELYI hónapkezdet UTC-pillanata', () => {
    const r = monthRange('2026-03')
    expect(new Date(r.startISO).getTime()).toBe(new Date(2026, 2, 1).getTime())
    expect(new Date(r.endISO).getTime()).toBe(new Date(2026, 3, 1).getTime())
  })
})

describe('currentYm', () => {
  it('YYYY-MM a helyi naptár szerint', () => {
    const now = new Date()
    expect(currentYm()).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  })
})

describe('sumAdvances — havi előleg-összeg (LOG-10)', () => {
  it('csak az adott hónap előlegei, a levonás nem', () => {
    const rows = [
      { type: 'advance', amount: 10000, work_date: '2026-11-02' },
      { type: 'advance', amount: '5000', work_date: '2026-11-20' },
      { type: 'deduction', amount: 3000, work_date: '2026-11-05' },
      { type: 'advance', amount: 7000, work_date: '2026-10-30' },
    ]
    expect(sumAdvances(rows, '2026-11')).toBe(15000)
    expect(sumAdvances(rows, '2026-10')).toBe(7000)
    expect(sumAdvances([], '2026-11')).toBe(0)
  })
})

const RATES = { driver: 25000, loader: 18000, trainee: 10000, box: 20000, boxTrainee: 8000, box2: 7000 }
const box = { category: { box_sheet: true } }
const xl = { category: { box_sheet: false } }

describe('payForDay — egy nap díja a beosztott szerepekből', () => {
  const comps = buildDayComps([
    { driver_id: 'a', loader_id: 'b', trainee_id: 'c', work_date: '2026-11-02', round: 1, car: xl },
    { driver_id: 'a', loader_id: null, trainee_id: null, work_date: '2026-11-03', round: 1, car: box },
    { driver_id: 'a', loader_id: null, trainee_id: 'c', work_date: '2026-11-03', round: 2, car: box },
    { driver_id: 'b', loader_id: null, trainee_id: null, work_date: '2026-11-04', round: 2, car: box },
    { driver_id: 'a', loader_id: null, trainee_id: null, work_date: '2026-11-05', round: 1, car: xl },
    { driver_id: 'a', loader_id: null, trainee_id: null, work_date: '2026-11-05', round: 1, car: box },
  ])
  it('XL sofőr / rakodó / betanuló', () => {
    expect(payForDay(comps.get('a|2026-11-02'), RATES)).toMatchObject({ rate: 25000, role: 'driver', label: 'XL sofőr', driver: 25000, loader: null })
    expect(payForDay(comps.get('b|2026-11-02'), RATES)).toMatchObject({ rate: 18000, role: 'loader', loader: 18000 })
    expect(payForDay(comps.get('c|2026-11-02'), RATES)).toMatchObject({ rate: 10000, role: 'trainee', trainee: 10000 })
  })
  it('Box: mindkét kör = napidíj + 2. kör ráadás; csak a 2. kör = egy napidíj', () => {
    expect(payForDay(comps.get('a|2026-11-03'), RATES)).toMatchObject({ rate: 27000, role: 'box', box: 20000, box2: 7000, rounds: 2, label: 'Box sofőr (2 kör)' })
    expect(payForDay(comps.get('b|2026-11-04'), RATES)).toMatchObject({ rate: 20000, box2: null, label: 'Box sofőr (2. kör)' })
    expect(payForDay(comps.get('c|2026-11-03'), RATES)).toMatchObject({ rate: 8000, role: 'box_trainee' })
  })
  it('XL sofőr + Box ugyanazon a napon: mindkét díj, a nap szerepe sofőr', () => {
    expect(payForDay(comps.get('a|2026-11-05'), RATES)).toMatchObject({ rate: 45000, role: 'driver', label: 'XL sofőr + Box sofőr (1. kör)' })
  })
  it('beosztás nélküli becsekkolás rakodóként; hiányzó napidíj 0', () => {
    expect(payForDay(undefined, RATES)).toMatchObject({ rate: 18000, role: 'loader', label: 'XL rakodó (beosztás nélkül)' })
    expect(payForDay(undefined, undefined).rate).toBe(0)
  })
})

describe('advanceCoverage — a ledolgozott napokból mennyi van kifizetve', () => {
  const worked = [
    { date: '2026-11-02', rate: 25000 }, { date: '2026-11-03', rate: 25000 },
    { date: '2026-11-04', rate: 18000 }, { date: '2026-11-05', rate: 18000 },
  ]
  it('megjelölt napok + érték szerinti százalék', () => {
    const c = advanceCoverage(worked, [
      { type: 'advance', amount: 50000, covered_dates: ['2026-11-02', '2026-11-03'] },
      { type: 'deduction', amount: 9000, covered_dates: null },
    ])
    expect([...c.paidDates]).toEqual(['2026-11-02', '2026-11-03'])
    expect(c).toMatchObject({ workedCount: 4, workedValue: 86000, paidCount: 2, advanced: 50000, remaining: 36000, percent: 58 })
  })
  it('nap-megjelölés nélküli (régi) előleg is beleszámít az összegbe', () => {
    const c = advanceCoverage(worked, [{ type: 'advance', amount: '43000' }])
    expect(c).toMatchObject({ paidCount: 0, advanced: 43000, remaining: 43000, percent: 50 })
  })
  it('nem ledolgozott napra tett jelölés nem számít; a százalék 100-nál megáll', () => {
    const c = advanceCoverage(worked, [{ type: 'advance', amount: 100000, covered_dates: ['2026-11-20'] }])
    expect(c).toMatchObject({ paidCount: 0, remaining: 0, percent: 100 })
  })
  it('napidíj nélkül a napok aránya adja a százalékot', () => {
    const c = advanceCoverage([{ date: '2026-11-02', rate: 0 }, { date: '2026-11-03', rate: 0 }], [{ type: 'advance', amount: 5000, covered_dates: ['2026-11-02'] }])
    expect(c.percent).toBe(50)
  })
})

describe('advanceLimitError — előleg legfeljebb a ledolgozott napok értékéig', () => {
  const worked = [{ date: '2026-11-02', rate: 25000 }, { date: '2026-11-03', rate: 25000 }]
  it('a még ki nem fizetett értékig mehet, afölött hiba', () => {
    const c = advanceCoverage(worked, [{ type: 'advance', amount: 20000 }])
    expect(advanceLimitError(30000, c)).toBeNull()
    expect(advanceLimitError(30001, c)).toMatch(/Legfeljebb 30000/)
  })
  it('ledolgozott nap nélkül nem adható; teljesen kifizetett hónapra sem', () => {
    expect(advanceLimitError(1000, advanceCoverage([], []))).toMatch(/nincs ledolgozott/)
    expect(advanceLimitError(1, advanceCoverage(worked, [{ type: 'advance', amount: 50000 }]))).toMatch(/teljes egészében/)
  })
  it('napidíj nélkül nincs mihez mérni — átengedi', () => {
    expect(advanceLimitError(99999, advanceCoverage([{ date: '2026-11-02', rate: 0 }], []))).toBeNull()
  })
})

describe('advanceDays — miből adható előleg', () => {
  const sh = (work_date: string, who: Partial<{ driver_id: string; loader_id: string; trainee_id: string }>) => ({ driver_id: null, loader_id: null, trainee_id: null, work_date, ...who })
  const shifts = [
    sh('2026-11-02', { driver_id: 'u1' }), sh('2026-11-02', { driver_id: 'u1' }), // két kör egy napon → egy nap
    sh('2026-11-03', { loader_id: 'u1' }), sh('2026-11-04', { trainee_id: 'u1' }),
    sh('2026-11-05', { driver_id: 'u2' }), // másé
    sh('2026-11-20', { driver_id: 'u1' }), // jövőbeli
  ]
  it('becsekkolás szerint: a becsekkolt napok, rendezve, ismétlés nélkül', () => {
    expect(advanceDays('checkin', 'u1', ['2026-11-03', '2026-11-01', '2026-11-03'], shifts, '2026-11-06')).toEqual(['2026-11-01', '2026-11-03'])
  })
  it('beosztás szerint: a saját beosztott napok a mai napig, bármelyik szerepben', () => {
    expect(advanceDays('schedule', 'u1', ['2026-11-01'], shifts, '2026-11-06')).toEqual(['2026-11-02', '2026-11-03', '2026-11-04'])
  })
  it('beosztás szerint a mai nap még beleszámít, a holnapi nem', () => {
    expect(advanceDays('schedule', 'u1', [], shifts, '2026-11-20')).toContain('2026-11-20')
    expect(advanceDays('schedule', 'u1', [], shifts, '2026-11-19')).not.toContain('2026-11-20')
  })
})

describe('defaultDateForMonth', () => {
  it('az aktuális hónapban a mai nap, korábbi hónapban a hónap utolsó napja', () => {
    expect(defaultDateForMonth('2026-11', '2026-11-06')).toBe('2026-11-06')
    expect(defaultDateForMonth('2026-10', '2026-11-06')).toBe('2026-10-31')
    expect(defaultDateForMonth('2026-02', '2026-11-06')).toBe('2026-02-28')
    expect(defaultDateForMonth('2028-02', '2028-11-06')).toBe('2028-02-29')
  })
})

describe('advanceLimitError — beosztás szerinti szöveg', () => {
  it('a hibaüzenet a választott alap szavát használja', () => {
    const empty = advanceCoverage([], [])
    expect(advanceLimitError(1000, empty, String, 'beosztott')).toContain('nincs beosztott napja')
    expect(advanceLimitError(1000, empty)).toContain('nincs ledolgozott napja')
    const cov = advanceCoverage([{ date: '2026-11-02', rate: 20000 }], [])
    expect(advanceLimitError(30000, cov, String, 'beosztott')).toContain('a beosztott napok értéke 20000')
    expect(advanceLimitError(20000, cov, String, 'beosztott')).toBeNull()
  })
})

describe('accountingDate — az előleg elszámolási napja a kifizetés napjából', () => {
  it('a hónapon belül a kifizetés napja', () => {
    expect(accountingDate('2026-11', '2026-11-06')).toBe('2026-11-06')
  })
  it('később kifizetett, korábbi hónapra szóló előleg a hónap utolsó napjára kerül', () => {
    expect(accountingDate('2026-10', '2026-11-06')).toBe('2026-10-31')
    expect(accountingDate('2026-02', '2026-03-02')).toBe('2026-02-28')
  })
  it('a hónap előtti kifizetés a hónap első napjára kerül', () => {
    expect(accountingDate('2026-11', '2026-10-30')).toBe('2026-11-01')
  })
})

describe('payrollDays — mely napok fizetendők', () => {
  const sh = (work_date: string, who: Partial<{ driver_id: string; loader_id: string; trainee_id: string }>, workspace_id = 'w1') => ({ driver_id: null, loader_id: null, trainee_id: null, work_date, workspace_id, ...who })
  const shifts = [
    sh('2026-11-02', { driver_id: 'u1', loader_id: 'u2' }), sh('2026-11-02', { driver_id: 'u1' }), // két kör egy napon
    sh('2026-11-06', { trainee_id: 'u1' }), sh('2026-11-07', { driver_id: 'u1' }), sh('2026-11-20', { loader_id: 'u2' }, 'w2'),
  ]
  const checkins = [{ user_id: 'u1', work_date: '2026-11-03', workspace_id: 'w1' }, { user_id: 'u1', work_date: '2026-11-03', workspace_id: 'w1' }]

  it('becsekkolás szerint: csak a becsekkolt napok, jövőbeli terv nélkül', () => {
    const r = payrollDays('checkin', checkins, shifts, '2026-11-06')
    expect([...r.paid.get('u1')!.keys()]).toEqual(['2026-11-03'])
    expect(r.paid.has('u2')).toBe(false)
    expect(r.future.size).toBe(0)
  })
  it('beosztás szerint: a mai napig beosztott napok fizetendők, becsekkolás nélkül is', () => {
    const r = payrollDays('schedule', checkins, shifts, '2026-11-06')
    expect([...r.paid.get('u1')!.keys()]).toEqual(['2026-11-02', '2026-11-06']) // a mai nap még beleszámít
    expect([...r.paid.get('u2')!.keys()]).toEqual(['2026-11-02'])
  })
  it('beosztás szerint a hátralévő napok külön, tervként, a saját munkaterületükkel', () => {
    const r = payrollDays('schedule', checkins, shifts, '2026-11-06')
    expect([...r.future.get('u1')!.keys()]).toEqual(['2026-11-07'])
    expect(r.future.get('u2')!.get('2026-11-20')).toBe('w2')
  })
  it('lezárt (múlt) hónapban minden beosztott nap fizetendő', () => {
    const r = payrollDays('schedule', [], shifts, '2026-12-05')
    expect(r.paid.get('u1')!.size).toBe(3)
    expect(r.future.size).toBe(0)
  })
})

describe('xlPayOf / boxPayOf — a bér XL és AlzaBox része', () => {
  it('az XL a sofőr + rakodó + betanuló, a Box az 1. kör + 2. kör + Box-betanuló', () => {
    const r = { driverPay: 100000, loaderPay: 36000, traineePay: 10000, boxPay: 75000, boxRound2Pay: 30000, boxTraineePay: 5000 }
    expect(xlPayOf(r)).toBe(146000)
    expect(boxPayOf(r)).toBe(110000)
    expect(xlPayOf(r) + boxPayOf(r)).toBe(256000)
  })
})
