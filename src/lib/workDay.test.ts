import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDaysISO, clearWorkDayPin, isAfterCutover, operationalDayISO, pinWorkDay, pinnedWorkDay, workDayISO } from './workDay'

const at = (s: string) => new Date(s) // helyi idő

describe('munkanap — este 18:00-kor vált', () => {
  it('hétfő este az 1. kör és kedd reggel a 2. kör is KEDD', () => {
    expect(operationalDayISO(at('2026-11-16T21:30:00'))).toBe('2026-11-17') // hétfő este → kedd
    expect(operationalDayISO(at('2026-11-16T23:59:00'))).toBe('2026-11-17')
    expect(operationalDayISO(at('2026-11-17T00:10:00'))).toBe('2026-11-17') // éjfél után is kedd
    expect(operationalDayISO(at('2026-11-17T05:30:00'))).toBe('2026-11-17') // 2. kör
    expect(operationalDayISO(at('2026-11-17T13:00:00'))).toBe('2026-11-17')
  })
  it('a váltás pontosan 18:00-kor van', () => {
    expect(operationalDayISO(at('2026-11-17T17:59:59'))).toBe('2026-11-17')
    expect(operationalDayISO(at('2026-11-17T18:00:00'))).toBe('2026-11-18')
    expect(isAfterCutover(at('2026-11-17T17:59:00'))).toBe(false)
    expect(isAfterCutover(at('2026-11-17T18:00:00'))).toBe(true)
  })
  it('hónap- és évváltás', () => {
    expect(operationalDayISO(at('2026-11-30T20:00:00'))).toBe('2026-12-01')
    expect(operationalDayISO(at('2026-12-31T19:00:00'))).toBe('2027-01-01')
    expect(addDaysISO('2026-12-01', -1)).toBe('2026-11-30')
  })
})

describe('rögzítés a nyitott becsekkoláshoz', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
    vi.useFakeTimers()
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('nappalos futár este 6 után is a saját napján marad, amíg le nem rakja az autót', () => {
    vi.setSystemTime(at('2026-11-17T06:00:00'))
    pinWorkDay('2026-11-17', 'u1')
    vi.setSystemTime(at('2026-11-17T18:30:00'))
    expect(workDayISO(new Date())).toBe('2026-11-17') // rögzítve
    clearWorkDayPin() // autó lerakva
    expect(workDayISO(new Date())).toBe('2026-11-18')
  })
  it('éjszakás futár: hétfő esti becsekkolás keddre szól, éjfélkor nem vált semmi', () => {
    vi.setSystemTime(at('2026-11-16T21:30:00'))
    pinWorkDay(operationalDayISO(new Date()), 'u1')
    expect(pinnedWorkDay()).toBe('2026-11-17')
    vi.setSystemTime(at('2026-11-17T00:05:00'))
    expect(workDayISO(new Date())).toBe('2026-11-17')
    vi.setSystemTime(at('2026-11-17T12:45:00'))
    expect(workDayISO(new Date())).toBe('2026-11-17')
  })
  it('a rögzítés 20 óra után magától lejár; az ismételt rögzítés nem tolja ki', () => {
    vi.setSystemTime(at('2026-11-17T06:00:00'))
    pinWorkDay('2026-11-17', 'u1')
    vi.setSystemTime(at('2026-11-17T20:00:00'))
    pinWorkDay('2026-11-17', 'u1') // újra — az időbélyeg az elsőé marad
    vi.setSystemTime(at('2026-11-18T03:00:00')) // 21 óra telt el
    expect(pinnedWorkDay()).toBeNull()
    expect(workDayISO(new Date())).toBe('2026-11-18')
  })
})
