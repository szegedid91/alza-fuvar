import { describe, it, expect } from 'vitest'
import { monthGrid, shiftMonth, addDays, mondayOf, localDateOf, monthTitle, shortName, crewSizeFor, groupByCategory } from './calendar'

describe('monthGrid — hétfő-kezdésű rács', () => {
  it('2026 október: csütörtökkel kezd → 3 üres cella elöl, 7-tel osztható hossz', () => {
    const g = monthGrid('2026-10')
    expect(g.slice(0, 3)).toEqual([null, null, null])
    expect(g[3]).toBe('2026-10-01')
    expect(g.length % 7).toBe(0)
    expect(g.filter(Boolean).length).toBe(31)
  })
  it('február szökőévben 29 nap', () => {
    expect(monthGrid('2028-02').filter(Boolean).length).toBe(29)
  })
})

describe('shiftMonth / addDays / mondayOf', () => {
  it('hónapléptetés évhatáron át', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
  it('napléptetés hónap- és évhatáron át (helyi naptár)', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('mondayOf: vasárnapról az előző hétfőre, hétfőről önmagára', () => {
    expect(mondayOf('2026-10-11')).toBe('2026-10-05') // vasárnap
    expect(mondayOf('2026-10-05')).toBe('2026-10-05')
  })
})

describe('localDateOf', () => {
  it('a helyi naptári napot adja (nem az UTC-t)', () => {
    const d = new Date(2026, 9, 11, 0, 30) // helyi éjfél után
    expect(localDateOf(d.toISOString())).toBe('2026-10-11')
  })
})

describe('monthTitle / shortName', () => {
  it('magyar hónapnév', () => {
    expect(monthTitle('2026-10')).toBe('2026. október')
  })
  it('a név utolsó tagja, max 7 karakter', () => {
    expect(shortName('Kovács János')).toBe('János')
    expect(shortName('Nagy Krisztián')).toBe('Kriszti')
    expect(shortName(null)).toBe('—')
  })
})

describe('crewSizeFor / groupByCategory', () => {
  const categories = [{ id: 'box', name: 'Box', crew_size: 1 }, { id: 'xl', name: 'XL', crew_size: 2 }]
  const cars = [
    { id: 'a', plate: 'AAA-111', category_id: 'box' },
    { id: 'b', plate: 'BBB-222', category_id: 'xl' },
    { id: 'c', plate: 'CCC-333', category_id: null },
  ] as unknown as Parameters<typeof crewSizeFor>[0]
  it('Box = 1 fő, egyébként 2 (ismeretlen autónál is 2)', () => {
    expect(crewSizeFor(cars, categories, 'a')).toBe(1)
    expect(crewSizeFor(cars, categories, 'b')).toBe(2)
    expect(crewSizeFor(cars, categories, 'zzz')).toBe(2)
  })
  it('kategória-sorrend, a kategória nélküli "Egyéb" a végén', () => {
    const g = groupByCategory(cars!, categories)
    expect(g.map((x) => x.name)).toEqual(['Box', 'XL', 'Egyéb'])
    expect(g[2].cars[0].id).toBe('c')
  })
})
