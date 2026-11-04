import { describe, it, expect } from 'vitest'
import { monthRange, currentYm, sumAdvances } from './payroll'

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
