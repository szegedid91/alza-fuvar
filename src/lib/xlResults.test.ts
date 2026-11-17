import { describe, it, expect } from 'vitest'
import { parseXlSheet, sheetDateISO, sameName, matchXlCells, type XlShiftLike } from './xlResults'

// a megbízó táblázatának formája (kitalált nevekkel)
const SHEET: unknown[][] = [
  ['Dátum', null, 'UX22', null, 'Cím ', 'Megjegyzés', 'UX23', null, 'Cím ', 'Megjegyzés', 'UX34', null, 'Cím ', 'Megjegyzés'],
  [46296, 'Csütörtök', 'Kis Anna/Nagy Béla', null, 12, null, null, null, null, null, null, null, null, null],
  [46297, 'Péntek', 'Kis Anna/Nagy Béla', null, 15, '+1cím', 'Tóth Cili/ Vad Dénes', null, 11, null, null, null, null, null],
  [46298, 'Szombat', 'Kis Anna/Nagy Béla', null, 14, null, 'Tóth Cili/Vad Dénes', null, null, null, null, null, null, null],
  [46299, 'Vasárnap', null, null, null, null, null, null, null, null, 'Vad Dénes/Nagy Béla', null, 0, null],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null],
]

describe('sheetDateISO', () => {
  it('sorszám, szöveg és Date', () => {
    expect(sheetDateISO(46296)).toBe('2026-10-01')
    expect(sheetDateISO('2026.10.01.')).toBe('2026-10-01')
    expect(sheetDateISO('10/1/26')).toBe('2026-10-01')
    expect(sheetDateISO(new Date(2026, 9, 14))).toBe('2026-10-14')
    expect(sheetDateISO('Összesen')).toBeNull()
    expect(sheetDateISO('2026.13.01')).toBeNull()
    expect(sheetDateISO(12)).toBeNull()
  })
})

describe('parseXlSheet', () => {
  it('járatonként kiolvassa a napot, a párost, a címszámot és a megjegyzést', () => {
    const { cells, problems } = parseXlSheet(SHEET)
    expect(problems).toEqual([])
    expect(cells).toEqual([
      { date: '2026-10-01', route: 'UX22', names: ['Kis Anna', 'Nagy Béla'], count: 12, note: null },
      { date: '2026-10-02', route: 'UX22', names: ['Kis Anna', 'Nagy Béla'], count: 15, note: '+1cím' },
      { date: '2026-10-02', route: 'UX23', names: ['Tóth Cili', 'Vad Dénes'], count: 11, note: null },
      { date: '2026-10-03', route: 'UX22', names: ['Kis Anna', 'Nagy Béla'], count: 14, note: null },
      { date: '2026-10-04', route: 'UX34', names: ['Vad Dénes', 'Nagy Béla'], count: 0, note: null },
    ])
  })
  it('hibás lapot és rossz számot jelez, nem talál ki adatot', () => {
    expect(parseXlSheet([['valami']]).problems).toHaveLength(1)
    const r = parseXlSheet([['Dátum', null, 'UX22', null, 'Cím'], [46296, null, 'Kis Anna', null, 'sok'], ['nem dátum', null, 'Kis Anna', null, 9]])
    expect(r.cells).toEqual([])
    expect(r.problems).toHaveLength(2)
  })
})

describe('matchXlCells', () => {
  const sh = (date: string, car: string, driver: string, loader: string | null): XlShiftLike => ({
    work_date: date, car_id: car, plate: car.toUpperCase(),
    people: [{ id: driver, name: driver, driver: true }, ...(loader ? [{ id: loader, name: loader, driver: false }] : [])],
  })
  const cell = (date: string, route: string, names: string[], count = 10) => ({ date, route, names, count, note: null })

  it('a nevek ékezet és sorrend nélkül is egyeznek', () => {
    expect(sameName('Kis  Anna', 'kis anna')).toBe(true)
    expect(sameName('Tóth Cili', 'Cili Toth')).toBe(true)
    expect(sameName('Kis Anna', 'Kis Antal')).toBe(false)
    expect(sameName('', null)).toBe(false)
  })
  it('a sofőr autója nyer, ha a rakodók fel vannak cserélve', () => {
    const shifts = [sh('2026-10-12', 'a', 'Kis Anna', 'Vad Dénes'), sh('2026-10-12', 'b', 'Tóth Cili', 'Nagy Béla')]
    const { matched, unmatched } = matchXlCells([cell('2026-10-12', 'UX22', ['Kis Anna', 'Nagy Béla']), cell('2026-10-12', 'UX34', ['Tóth Cili', 'Vad Dénes'])], shifts)
    expect(unmatched).toEqual([])
    expect(matched.map((m) => [m.cell.route, m.car_id, m.partial])).toEqual([['UX22', 'a', true], ['UX34', 'b', true]])
  })
  it('ami nem egyértelmű, az nem párosul', () => {
    const shifts = [sh('2026-10-01', 'a', 'Kis Anna', 'Nagy Béla'), sh('2026-10-01', 'b', 'Tóth Cili', 'Vad Dénes')]
    const r = matchXlCells([
      cell('2026-10-02', 'UX22', ['Kis Anna']),               // nincs beosztás aznap
      cell('2026-10-01', 'UX22', ['Senki Sem']),              // ismeretlen név
      cell('2026-10-01', 'UX23', ['Nagy Béla', 'Vad Dénes']), // két autó, egy-egy rakodó: döntetlen
      cell('2026-10-01', 'UX34', []),                         // nincs név
      cell('2026-10-01', 'UX22', ['Kis Anna', 'Nagy Béla']),
      cell('2026-10-01', 'UX99', ['Nagy Béla']),              // ugyanarra az autóra gyengébb sor
    ], shifts)
    expect(r.matched.map((m) => [m.cell.route, m.car_id, m.partial])).toEqual([['UX22', 'a', false]])
    expect(r.unmatched.map((u) => u.cell.route)).toEqual(['UX22', 'UX22', 'UX23', 'UX34', 'UX99'])
  })
})
