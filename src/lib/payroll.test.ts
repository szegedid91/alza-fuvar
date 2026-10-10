import { describe, it, expect } from 'vitest'
import { monthRange, currentYm } from './payroll'

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
