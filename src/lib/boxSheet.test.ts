import { describe, expect, it } from 'vitest'
import { stopMessageLines } from './boxSheet'

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
