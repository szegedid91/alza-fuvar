import { describe, expect, it } from 'vitest'
import { diffFields, lateEdits, lateEditsBySheet, type AuditRow } from './boxSheetAudit'

const row = (id: string, entity: string, action: string, detail: Record<string, unknown>, at = '2026-11-10T18:40:00Z'): AuditRow => ({ id, entity, action, actor_id: 'u1', created_at: at, entity_id: 'e', detail })

describe('diffFields', () => {
  it('csak a változott mezők, magyar címkével, technikai mezők nélkül', () => {
    const d = diffFields({ id: 'x', placed: 35, shortage: 3, note: null, updated_at: 'a' }, { id: 'x', placed: 35, shortage: 5, note: 'tele volt', updated_at: 'b' })
    expect(d).toEqual([{ label: 'Hiány', from: '3', to: '5' }, { label: 'Megjegyzés', from: '—', to: 'tele volt' }])
  })
  it('lap: végzés és állapot olvashatóan', () => {
    expect(diffFields({ end_time: '21:12:00', status: 'draft' }, { end_time: '21:30:00', status: 'submitted' })).toEqual([{ label: 'Végzés', from: '21:12', to: '21:30' }, { label: 'Állapot', from: 'Piszkozat', to: 'Lezárva' }])
  })
})

describe('lateEdits', () => {
  const rows = [
    row('1', 'box_sheet_stops', 'UPDATE', { late: true, sheet_id: 's1', box_code: 'AB9014', old: { shortage: 3 }, new: { shortage: 5 } }, '2026-11-10T18:40:00Z'),
    row('2', 'box_sheet_stops', 'UPDATE', { late: false, sheet_id: 's1', box_code: 'AB9014', old: { shortage: 0 }, new: { shortage: 3 } }, '2026-11-10T16:05:00Z'),
    row('3', 'box_sheet_stops', 'DELETE', { late: true, sheet_id: 's1', box_code: 'AB9128', old: { placed: 2 }, new: null }, '2026-11-10T18:50:00Z'),
    row('4', 'box_sheets', 'UPDATE', { late: true, sheet_id: 's2', old: { end_time: '21:12:00' }, new: { end_time: '21:30:00' } }, '2026-11-10T18:30:00Z'),
    row('5', 'box_sheets', 'UPDATE', { late: true, sheet_id: 's2', old: { end_time: '21:30:00' }, new: { end_time: '21:30:00' } }, '2026-11-10T18:31:00Z'),
  ]
  it('csak az utólagos, tényleges változások; törlés is; időrendben', () => {
    const e = lateEdits(rows)
    expect(e.map((x) => x.id)).toEqual(['4', '1', '3'])
    expect(e[1]).toMatchObject({ box: 'AB9014', deleted: false, changes: [{ label: 'Hiány', from: '3', to: '5' }] })
    expect(e[2]).toMatchObject({ box: 'AB9128', deleted: true })
  })
  it('lapra bontva', () => {
    const m = lateEditsBySheet(rows)
    expect(m.get('s1')!.map((x) => x.id)).toEqual(['1', '3'])
    expect(m.get('s2')!.map((x) => x.id)).toEqual(['4'])
  })
})
