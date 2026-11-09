import { describe, expect, it } from 'vitest'
import { dayComplete, roundStates } from './rounds'

const ev = (kind: string, hm: string) => ({ kind, at: `2026-11-10T${hm}:00Z` })

describe('roundStates', () => {
  it('jelzés nélkül az első kör aktuális, a többi következik', () => {
    expect(roundStates(2, []).map((s) => s.status)).toEqual(['current', 'upcoming'])
  })
  it('a „Járat kész” után a kör még nyitott, amíg el nem számol vagy ki nem indul újra', () => {
    const s = roundStates(2, [ev('departed', '05:30'), ev('done', '09:00')])
    expect(s[0]).toEqual({ status: 'current', doneAt: '2026-11-10T09:00:00Z', settledAt: null })
    expect(s[1].status).toBe('upcoming')
  })
  it('az első kör elszámolása után az első lezárt, a második aktuális', () => {
    const s = roundStates(2, [ev('departed', '05:30'), ev('done', '09:00'), ev('arrived', '09:40'), ev('settled', '09:50')])
    expect(s[0]).toEqual({ status: 'completed', doneAt: '2026-11-10T09:00:00Z', settledAt: '2026-11-10T09:50:00Z' })
    expect(s[1].status).toBe('current')
  })
  it('elszámolás nélkül a második körre kiindulva is lezárul az első', () => {
    const s = roundStates(2, [ev('done', '09:00'), ev('arrived', '09:40'), ev('departed', '10:00')])
    expect(s[0].status).toBe('completed')
    expect(s[0].settledAt).toBeNull()
    expect(s[1].status).toBe('current')
  })
  it('a második kör elszámolása nem az elsőhöz számít', () => {
    const s = roundStates(2, [ev('done', '09:00'), ev('departed', '10:00'), ev('done', '14:00'), ev('settled', '14:30')])
    expect(s[0].settledAt).toBeNull()
    expect(s[1]).toEqual({ status: 'completed', doneAt: '2026-11-10T14:00:00Z', settledAt: '2026-11-10T14:30:00Z' }) // az utolsó kör is lezárt: jön a Nap vége
  })
})

describe('dayComplete', () => {
  it('két körnél csak a második elszámolása zárja a napot', () => {
    const first = [ev('done', '09:00'), ev('settled', '09:50')]
    expect(dayComplete(2, first)).toBe(false)
    expect(dayComplete(2, [...first, ev('departed', '10:00'), ev('done', '14:00'), ev('settled', '14:30')])).toBe(true)
  })
  it('egy körnél a kész + elszámolás', () => {
    expect(dayComplete(1, [ev('done', '09:00')])).toBe(false)
    expect(dayComplete(1, [ev('done', '09:00'), ev('settled', '09:50')])).toBe(true)
  })
  it('járat nélkül az első elszámolás', () => {
    expect(dayComplete(0, [ev('settled', '09:50')])).toBe(true)
    expect(dayComplete(0, [])).toBe(false)
  })
})
