import { describe, it, expect } from 'vitest'
import { parseHuNumber, formatHours, isCrewRole, todayISO, localISODate } from './labels'

describe('parseHuNumber — magyar számbevitel', () => {
  it('ezres szóköz + vessző tizedes', () => {
    expect(parseHuNumber('1 234,5')).toBe(1234.5)
    expect(parseHuNumber('1 234')).toBe(1234) // nem-törő szóköz
  })
  it('pontozott ezres + vessző tizedes', () => {
    expect(parseHuNumber('1.234,56')).toBe(1234.56)
  })
  it('csak pont: egy pont tizedes, több pont ezres-csoport (LOG-01)', () => {
    expect(parseHuNumber('1.234')).toBe(1.234)
    expect(parseHuNumber('45.123')).toBe(45.123) // 3 tizedesű liter a blokkon
    expect(parseHuNumber('12.5')).toBe(12.5)
    expect(parseHuNumber('1.234.567')).toBe(1234567)
    expect(parseHuNumber('12.345.678')).toBe(12345678)
  })
  it('egyszerű egész és negatív', () => {
    expect(parseHuNumber('25000')).toBe(25000)
    expect(parseHuNumber('-500')).toBe(-500)
  })
  it('érvénytelen → NaN (a hívó Number.isFinite-tel ellenőriz)', () => {
    expect(Number.isNaN(parseHuNumber(''))).toBe(true)
    expect(Number.isNaN(parseHuNumber('abc'))).toBe(true)
  })
  it('pénznem-jelet és szöveget eldob', () => {
    expect(parseHuNumber('12 500 Ft')).toBe(12500)
  })
})

describe('formatHours', () => {
  it('egy tizedesre kerekít, magyar vesszővel', () => {
    expect(formatHours(8.5 * 3600000)).toBe('8,5 ó')
    expect(formatHours(8.04 * 3600000)).toBe('8 ó')
  })
})

describe('isCrewRole', () => {
  it('crew/driver/loader = munkatárs, manager/admin nem', () => {
    expect(isCrewRole('crew')).toBe(true)
    expect(isCrewRole('driver')).toBe(true)
    expect(isCrewRole('loader')).toBe(true)
    expect(isCrewRole('manager')).toBe(false)
    expect(isCrewRole('admin')).toBe(false)
    expect(isCrewRole(null)).toBe(false)
  })
})

describe('todayISO — helyi naptári nap', () => {
  it('YYYY-MM-DD formátum, a helyi dátummal egyezik', () => {
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(todayISO()).toBe(expected)
  })
})

describe('localISODate — helyi nap egy időpontból (LOG-38)', () => {
  it('éjfél körül a helyi nap, nem az UTC', () => {
    const d = new Date(2026, 10, 4, 0, 30) // 2026-11-04 00:30 helyi idő
    expect(localISODate(d)).toBe('2026-11-04')
    expect(localISODate(new Date(2026, 10, 3, 23, 59))).toBe('2026-11-03')
  })
})
