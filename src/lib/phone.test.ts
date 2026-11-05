import { describe, it, expect } from 'vitest'
import { normalizePhone, formatPhone } from './phone'

describe('normalizePhone — telefonszám a regisztrációnál és a Profilon', () => {
  it('magyar mobil bármelyik szokásos beírással', () => {
    for (const s of ['+36 30 123 4567', '06 30 123 4567', '06301234567', '0036301234567', '30/123-4567', '36301234567']) expect(normalizePhone(s)).toBe('+36301234567')
  })
  it('magyar vezetékes és külföldi szám országhívóval', () => {
    expect(normalizePhone('06 1 234 5678')).toBe('+3612345678')
    expect(normalizePhone('+36 62 123 456')).toBe('+3662123456')
    expect(normalizePhone('+421 903 123 456')).toBe('+421903123456')
    expect(normalizePhone('0040 721 234 567')).toBe('+40721234567')
  })
  it('elírt, csonka vagy országhívó nélküli szám nem megy át', () => {
    for (const s of ['0630123456', '06 30 123 45678', '123456', '1234567890', 'nincs', '', '   ', '+36', '+0123456789', null, undefined]) expect(normalizePhone(s)).toBeNull()
  })
  it('megjelenítés: a magyar mobil tagolva', () => {
    expect(formatPhone('+36301234567')).toBe('+36 30 123 4567')
    expect(formatPhone('+421903123456')).toBe('+421903123456')
    expect(formatPhone(null)).toBe('')
  })
})
