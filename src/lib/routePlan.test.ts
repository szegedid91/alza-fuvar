import { describe, it, expect } from 'vitest'
import { deadlineMin, lateMinutes, timeToMin, assertUniqueRouteCodes, planTime, planRound } from './routePlan'

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
  it('a 04:00-s határ két oldalán sem téved egy napot', () => {
    // határidő 05:00, most 03:00: még 2 óra van (korábban +1320 perc „késés” jött ki)
    expect(lateMinutes('05:00', 1, timeToMin('03:00')!)).toBe(-120)
    // határidő 03:30, most 04:30: 1 óra késés (korábban −1380 perc, a késés nem látszott)
    expect(lateMinutes('03:30', 1, timeToMin('04:30')!)).toBe(60)
    expect(lateMinutes('04:15', 1, timeToMin('03:40')!)).toBe(-35)
  })
  it('hiányzó határidő → null', () => {
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

describe('planRound / planTime — a terv idői arra a körre szólnak, amelyiknek az indulása a tervben van', () => {
  it('5:30-as tervezett indulás → nappali (2.) kör; 23:59 vagy ismeretlen → éjszakai (1.)', () => {
    expect(planRound('05:30:00')).toBe(2)
    expect(planRound('23:59')).toBe(1)
    expect(planRound('00:30')).toBe(1)
    expect(planRound(null)).toBe(1)
  })
  it('a terv körén az idő változatlan, a másik körön nincs idő', () => {
    expect(planTime('06:19:00', 2, '05:30:00')).toBe('06:19')
    expect(planTime('06:19:00', 1, '05:30:00')).toBeNull()
    expect(planTime('01:30', 1, '23:59')).toBe('01:30')
    expect(planTime('01:30', 2, '23:59')).toBeNull()
    expect(planTime(null, 2, '05:30')).toBeNull()
  })
  it('a 2. kör késése a terv határidejéhez képest', () => {
    expect(lateMinutes(planTime('11:00', 2, '05:30'), 1, timeToMin('11:20')!)).toBe(20)
    expect(lateMinutes(planTime('11:00', 1, '05:30'), 1, timeToMin('11:20')!)).toBeNull()
  })
})
