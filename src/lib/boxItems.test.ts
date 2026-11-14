import { describe, expect, it } from 'vitest'
import { ISSUE_KINDS, cleanPackageCode, issueKindLabel, issueMessage, issueStats, itemLines } from './boxItems'

describe('csomagszintű eltérések', () => {
  it('a csoportüzenet sorai', () => {
    expect(itemLines([
      { kind: 'damaged', package_code: '1612345678', note: 'eltört a doboz', return_to_depot: true },
      { kind: 'admin', package_code: null, note: null, return_to_depot: false },
    ])).toEqual(['Sérült: 1612345678 (visszaviszem) — eltört a doboz', 'ADMIN'])
  })
  it('csomagkód tisztítva', () => {
    expect(cleanPackageCode(' 1612 345 678 ')).toBe('1612345678')
    expect(cleanPackageCode('ab1')).toBeNull()
  })
  it('box-hiba üzenet', () => {
    expect(issueMessage({ kind: 'not_opening', boxLabel: 'AB9014 · Pomáz', at: new Date(2026, 10, 12, 2, 15), name: 'Kiss Béla', note: 'kétszer próbáltam' }))
      .toBe('Box-hiba – AB9014 · Pomáz – Nem nyílik a fiók – 02:15 – Kiss Béla: kétszer próbáltam')
  })
})

describe('issueStats', () => {
  it('boxonként számol, a leggyakoribb elöl, nyitott és biztonsági külön', () => {
    const s = issueStats([
      { box_id: 'b1', box_code: 'AB1', kind: 'not_opening', created_at: '2026-11-10T01:00:00Z', resolved_at: null },
      { box_id: 'b1', box_code: 'AB1', kind: 'scanner', created_at: '2026-11-11T01:00:00Z', resolved_at: '2026-11-11T09:00:00Z' },
      { box_id: 'b2', box_code: 'AB2', kind: 'security', created_at: '2026-11-12T01:00:00Z', resolved_at: null },
    ])
    expect(s[0]).toMatchObject({ label: 'AB1', total: 2, open: 1, security: 0, last: '2026-11-11T01:00:00Z', kinds: { not_opening: 1, scanner: 1 } })
    expect(s[1]).toMatchObject({ label: 'AB2', total: 1, security: 1 })
  })
})

describe('box-hiba fajták', () => {
  it('csak három választható; a régi fajták címkéje megmarad', () => {
    expect(ISSUE_KINDS.map((k) => k.key)).toEqual(['not_opening', 'scanner', 'other'])
    expect(issueKindLabel('security')).toBe('Biztonsági esemény')
    expect(issueKindLabel('emergency')).toBe('Emergency kidobott')
  })
})
