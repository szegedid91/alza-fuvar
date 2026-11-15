import { describe, expect, it } from 'vitest'
import { missedStops, stopInRound, stopMessageLines } from './boxSheet'

describe('stopMessageLines — a csoportüzenet sorai', () => {
  it('teljes szöveggel, rövidítés nélkül, „db”-vel; csak ami nem nulla', () => {
    expect(stopMessageLines({ placed: 35, nf: 2, do_not_place: 3, shortage: 1, invalid_code: 0 })).toEqual([
      'Behelyezve: 35 db',
      'Nem fért be (nincs szabad fiók): 2 db',
      'Hiány: 1 db',
      'Ne helyezd be: 3 db',
    ])
  })
  it('a behelyezett darabszám nullával is látszik', () => {
    expect(stopMessageLines({ placed: 0, left_on_car: 4 })).toEqual(['Behelyezve: 0 db', 'Autón maradt: 4 db'])
    expect(stopMessageLines({})).toEqual(['Behelyezve: 0 db'])
  })
  it('minden fajta kiírva', () => {
    expect(stopMessageLines({ placed: 1, missorted: 1, nf: 1, oversize: 1, shortage: 1, returned: 1, invalid_code: 1, do_not_place: 1, cancelled: 1, left_on_car: 1 })).toEqual([
      'Behelyezve: 1 db', 'Rosszul szortírozott: 1 db', 'Nem fért be (nincs szabad fiók): 1 db', 'Túlméretes, nem fér be: 1 db', 'Hiány: 1 db',
      'Visszáru a boxból: 1 db', 'Érvénytelen kód: 1 db', 'Ne helyezd be: 1 db', 'Törölt csomag: 1 db', 'Autón maradt: 1 db',
    ])
  })
})

describe('missedStops — a járat kimaradt boxai', () => {
  const r = [{ box_id: 'a' }, { box_id: 'b' }, { box_id: 'c' }]
  it('ami már szerepel a lapon, kimarad; a sorszám az eredeti cím-sorszám', () => {
    expect(missedStops([r], ['b', null])).toEqual([[{ stop: { box_id: 'a' }, n: 1 }, { stop: { box_id: 'c' }, n: 3 }]])
  })
  it('két kör külön lista; a mindkét körben szereplő box annyiszor számít leadottnak, ahány sora van', () => {
    const g = [{ box_id: 'c' }, { box_id: 'd' }]
    expect(missedStops([r, g], ['a', 'b', 'c'])).toEqual([[], [{ stop: { box_id: 'c' }, n: 1 }, { stop: { box_id: 'd' }, n: 2 }]])
    expect(missedStops([r, g], ['a', 'b', 'c', 'c', 'd'])).toEqual([[], []])
  })
  it('üres lapnál a járat minden boxa kimaradt', () => {
    expect(missedStops([r], []).map((x) => x.length)).toEqual([3])
  })
})

describe('stopInRound — a megálló melyik körhöz tartozik', () => {
  const r2 = '2026-11-17T05:30:00.000Z' // a 2. kör „Kiindultam” jelzése
  it('az 1. körben kitöltött sor nem számít a 2. körben', () => {
    expect(stopInRound({ done_at: '2026-11-16T23:10:00.000Z' }, r2)).toBe(false)
    expect(stopInRound({ done_at: '2026-11-17T06:05:00+00:00' }, r2)).toBe(true)
  })
  it('más időformátum (Z és +00:00) is összevethető; 1 perc tűrés', () => {
    expect(stopInRound({ done_at: '2026-11-17T05:29:30+00:00' }, r2)).toBe(true)
    expect(stopInRound({ created_at: '2026-11-17T05:28:00.000Z' }, r2)).toBe(false)
  })
  it('körkezdet vagy idő nélkül minden megálló számít', () => {
    expect(stopInRound({ done_at: '2026-11-16T23:10:00.000Z' }, null)).toBe(true)
    expect(stopInRound({}, r2)).toBe(true)
  })
})
