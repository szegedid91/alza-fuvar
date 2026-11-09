import { describe, expect, it } from 'vitest'
import { cleanUnmapped, groupUnmapped, mergeStopNote, unmappedKey } from './boxUnmapped'

describe('unmappedKey / cleanUnmapped', () => {
  it('kis- és nagybetű, ékezet, írásjel nem számít', () => {
    expect(unmappedKey('A fiók nem nyílik!')).toBe('a fiok nem nyilik')
    expect(unmappedKey('  Kommunikációs   hiba. ')).toBe('kommunikacios hiba')
  })
  it('ismétlődés és szemét kiszűrve, legfeljebb 8', () => {
    expect(cleanUnmapped(['A fiók nem nyílik', 'a fiók nem nyílik!', '', 'ok', 42, '  Kommunikációs hiba '])).toEqual(['A fiók nem nyílik', 'Kommunikációs hiba'])
    expect(cleanUnmapped(Array.from({ length: 12 }, (_, i) => `üzenet ${i}`))).toHaveLength(8)
    expect(cleanUnmapped(null)).toEqual([])
  })
})

describe('mergeStopNote', () => {
  it('üres megjegyzéshez hozzáfűzi a kijelző üzeneteit', () => {
    expect(mergeStopNote(null, ['A fiók nem nyílik'])).toBe('Kijelző: A fiók nem nyílik')
  })
  it('meglévő megjegyzés megmarad, az új sorok alá kerülnek, ami már benne van, nem duplázódik', () => {
    const n = mergeStopNote('tele volt\nKijelző: A fiók nem nyílik', ['a fiók nem nyílik!', 'Kommunikációs hiba'])
    expect(n).toBe('tele volt\nKijelző: A fiók nem nyílik\nKijelző: Kommunikációs hiba')
  })
  it('nincs új üzenet → a megjegyzés változatlan', () => {
    expect(mergeStopNote('valami', [])).toBe('valami')
  })
})

describe('groupUnmapped', () => {
  const r = (id: string, text: string, box: string | null, at: string, resolved: string | null = null) => ({ id, text, text_key: unmappedKey(text), box_code: box, created_at: at, resolved_at: resolved })
  it('üzenetenként számol, a leggyakoribb elöl, a legutóbbi szöveggel és a boxokkal', () => {
    const g = groupUnmapped([
      r('1', 'A fiók nem nyílik', 'AB1', '2026-11-01T10:00:00Z'),
      r('2', 'a fiók nem nyílik!', 'AB2', '2026-11-03T10:00:00Z'),
      r('3', 'Kommunikációs hiba', 'AB1', '2026-11-02T10:00:00Z'),
      r('4', 'Régi, elintézve', 'AB9', '2026-11-02T10:00:00Z', '2026-11-05T10:00:00Z'),
    ])
    expect(g).toHaveLength(2)
    expect(g[0]).toMatchObject({ text: 'a fiók nem nyílik!', count: 2, boxes: ['AB1', 'AB2'], first: '2026-11-01T10:00:00Z', last: '2026-11-03T10:00:00Z', ids: ['1', '2'] })
    expect(g[1]).toMatchObject({ text: 'Kommunikációs hiba', count: 1 })
  })
})
