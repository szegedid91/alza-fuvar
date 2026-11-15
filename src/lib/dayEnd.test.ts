import { describe, expect, it } from 'vitest'
import { cleaningLine, fuelLine, roundLines } from './dayEnd'

const hhmm = (iso: string) => iso.slice(11, 16)

describe('lezárt nap összefoglalója', () => {
  it('körönként a járat: egy körnél is sorszámmal, a második csak ha volt', () => {
    const states = [{ status: 'completed' as const, doneAt: '2026-11-15T05:12:00Z', settledAt: null }, { status: 'completed' as const, doneAt: '2026-11-15T11:40:00Z', settledAt: '2026-11-15T12:10:00Z' }]
    expect(roundLines([{ round: 1, code: 'R' }], states, hhmm)).toEqual([{ title: '1. kör: R járat', detail: 'járat kész 05:12', done: true }])
    expect(roundLines([{ round: 1, code: 'R' }, { round: 2, code: 'G' }], states, hhmm).map((l) => l.title)).toEqual(['1. kör: R járat', '2. kör: G járat'])
  })
  it('a le nem zárt kör jelölve', () => {
    expect(roundLines([{ round: 1, code: 'J' }], [{ status: 'current', doneAt: null, settledAt: null }], hhmm)).toEqual([{ title: '1. kör: J járat', detail: 'nem lett kész', done: false }])
  })
  it('takarítás: volt (idővel, fotószámmal) vagy nem volt', () => {
    expect(cleaningLine({ done: true, at: '2026-11-15T22:22:00Z', photos: 2 }, hhmm)).toEqual({ title: 'Takarítás', detail: 'megvolt 22:22 · 2 fotó', done: true })
    expect(cleaningLine({ done: true, at: '2026-11-15T22:22:00Z', photos: 0 }, hhmm).detail).toBe('megvolt 22:22 · fotó nélkül')
    expect(cleaningLine({ done: false, at: null, photos: 0 }, hhmm)).toEqual({ title: 'Takarítás', detail: 'nem volt', done: false })
    expect(cleaningLine(null, hhmm).done).toBe(false)
  })
  it('tankolás: volt (literrel, blokkal) vagy nem volt', () => {
    expect(fuelLine({ done: true, at: '2026-11-15T21:05:00Z', liters: 45.23 }, hhmm)).toEqual({ title: 'Tankolás', detail: 'megvolt 21:05 · 45,2 l · blokk feltöltve', done: true })
    expect(fuelLine({ done: false, at: null, liters: 0 }, hhmm)).toEqual({ title: 'Tankolás', detail: 'nem volt', done: false })
  })
})
