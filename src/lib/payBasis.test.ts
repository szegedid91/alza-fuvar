// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { readPayBasis, savePayBasis } from './payBasis'

describe('payBasis — közös alap a bérhez és az előleghez', () => {
  beforeEach(() => localStorage.clear())
  it('alapból becsekkolás szerint', () => {
    expect(readPayBasis()).toBe('checkin')
  })
  it('a mentett választás visszajön', () => {
    savePayBasis('schedule')
    expect(readPayBasis()).toBe('schedule')
    savePayBasis('checkin')
    expect(readPayBasis()).toBe('checkin')
  })
  it('a korábbi, oldalankénti beállítást átveszi', () => {
    localStorage.setItem('alza-payroll-basis', 'planned')
    expect(readPayBasis()).toBe('schedule')
    localStorage.clear()
    localStorage.setItem('alza-advance-basis', 'schedule')
    expect(readPayBasis()).toBe('schedule')
  })
  it('az új beállítás felülírja a régit', () => {
    localStorage.setItem('alza-payroll-basis', 'planned')
    savePayBasis('checkin')
    expect(readPayBasis()).toBe('checkin')
  })
})
