import { describe, it, expect } from 'vitest'
import { deadlineMin, lateMinutes, timeToMin, assertUniqueRouteCodes } from './routePlan'

describe('lateMinutes — késés a határidőhöz képest (LOG-02)', () => {
  it('nappal: most − határidő', () => {
    expect(lateMinutes('10:00', 1, timeToMin('10:30')!)).toBe(30)
    expect(lateMinutes('10:00', 1, timeToMin('09:45')!)).toBe(-15)
  })
  it('hajnali határidő (04:00 előtt) a következő napra szól, és a hajnali „most” is', () => {
    expect(deadlineMin('01:30')).toBe(90 + 1440)
    // 23:50-kor az 01:30-as határidő még 100 perc múlva jár le
    expect(lateMinutes('01:30', 1, timeToMin('23:50')!)).toBe(-100)
    // 02:00-kor az 01:30-as határidő 30 perce lejárt — korábban nagy negatív szám jött ki
    expect(lateMinutes('01:30', 1, timeToMin('02:00')!)).toBe(30)
    // 00:10-kor egy 22:00-s határidő 130 perce lejárt
    expect(lateMinutes('22:00', 1, timeToMin('00:10')!)).toBe(130)
  })
  it('2. kör és hiányzó határidő → null', () => {
    expect(lateMinutes('10:00', 2, 700)).toBeNull()
    expect(lateMinutes(null, 1, 700)).toBeNull()
  })
})

describe('assertUniqueRouteCodes — duplikált járatkód a tervfájlban (LOG-05)', () => {
  it('két jármű azonos kóddal → hiba a nevekkel', () => {
    expect(() => assertUniqueRouteCodes([{ vehicle: 'Budapest G', code: 'G' }, { vehicle: 'Pest G', code: 'G' }, { vehicle: 'Buda H', code: 'H' }]))
      .toThrow(/G \(Budapest G, Pest G\)/)
  })
  it('egyedi kódok → nincs hiba', () => {
    expect(() => assertUniqueRouteCodes([{ vehicle: 'A 1', code: '1' }, { vehicle: 'B 2', code: '2' }])).not.toThrow()
  })
})
