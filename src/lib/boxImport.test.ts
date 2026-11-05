import { describe, it, expect } from 'vitest'
import { batchStartFromRows, boxSyncStatus } from './boxImport'

describe('batchStartFromRows — inaktiválási határ a szerver időbélyegeiből (LOG-11)', () => {
  it('a legkisebb updated_at (ISO, lexikografikusan rendezhető)', () => {
    expect(batchStartFromRows([
      { updated_at: '2026-11-04T05:00:02.000Z' }, { updated_at: '2026-11-04T05:00:01.500Z' }, { updated_at: null },
    ])).toBe('2026-11-04T05:00:01.500Z')
  })
  it('nincs időbélyeg → null (nem inaktiválunk vakon)', () => {
    expect(batchStartFromRows([])).toBeNull()
    expect(batchStartFromRows([{ updated_at: null }])).toBeNull()
  })
})

describe('boxSyncStatus — az automatikus jegyzék-frissítés állapota', () => {
  const when = (iso: string) => iso.slice(0, 16).replace('T', ' ')
  const now = new Date('2026-11-06T10:00:00Z').getTime()
  const run = { ran_at: '2026-11-05T16:44:00Z', ok: true, listed: 824, added: 6, deactivated: 2, note: null }
  it('friss, sikeres futás: darabszámok', () => {
    expect(boxSyncStatus(run, when, now)).toEqual({ tone: 'ok', text: 'Utolsó automatikus frissítés: 2026-11-05 16:44 — 824 box, 6 új, 2 megszűnt.' })
    expect(boxSyncStatus({ ...run, added: 0, deactivated: 0 }, when, now).text).toContain('824 box, nincs változás.')
  })
  it('sikertelen futás hibaként, az okkal', () => {
    const s = boxSyncStatus({ ...run, ok: false, note: 'alza.hu 403' }, when, now)
    expect(s.tone).toBe('error'); expect(s.text).toContain('alza.hu 403')
  })
  it('két napnál régebbi vagy hiányzó futás figyelmeztetés', () => {
    const old = boxSyncStatus({ ...run, ran_at: '2026-11-02T08:00:00Z' }, when, now)
    expect(old.tone).toBe('warn'); expect(old.text).toContain('Több mint 4 napja nem futott')
    expect(boxSyncStatus(null, when, now).tone).toBe('warn')
  })
  it('a csonka lista megjegyzése megjelenik', () => {
    expect(boxSyncStatus({ ...run, added: 0, deactivated: 0, note: 'A lista rövidebb a vártnál.' }, when, now).text).toContain('A lista rövidebb a vártnál.')
  })
})
