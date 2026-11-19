import { describe, it, expect } from 'vitest'
import { niceTicks, compactHuf, monthShort, dayShort } from './chartUtils'

describe('chartUtils', () => {
  it('kerek osztások a legnagyobb érték fölé', () => {
    expect(niceTicks(0)).toEqual([0, 1])
    expect(niceTicks(19)).toEqual([0, 5, 10, 15, 20])
    expect(niceTicks(430000)).toEqual([0, 200000, 400000, 600000])
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8])
    const t = niceTicks(123456)
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(123456)
  })
  it('tömör forint és rövid dátumok', () => {
    expect(compactHuf(0)).toBe('0')
    expect(compactHuf(50000)).toBe('50 e')
    expect(compactHuf(1250000).replace(/\s/g, ' ')).toBe('1,3 M')
    expect(monthShort('2026-11')).toBe('nov.')
    expect(monthShort('2027-01')).toBe('2027 jan.')
    expect(dayShort('2026-11-03')).toBe('11.03.')
  })
})
