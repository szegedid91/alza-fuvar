import { describe, expect, it } from 'vitest'
import { cleanBoxNote, visibleBoxNotes, type BoxNote } from './boxNotes'

describe('cleanBoxNote', () => {
  it('szóközök összevonva, túl rövid nem mehet, hosszú levágva', () => {
    expect(cleanBoxNote('  a  hátsó   bejáratnál  ')).toBe('a hátsó bejáratnál')
    expect(cleanBoxNote(' x ')).toBeNull()
    expect(cleanBoxNote('a'.repeat(600))).toHaveLength(500)
  })
})

describe('visibleBoxNotes', () => {
  const n = (id: string, status: BoxNote['status'], created_by: string, at: string): BoxNote => ({ id, box_id: 'b', text: id, status, created_by, created_at: at, reviewed_at: null })
  const notes = [n('p-other', 'pending', 'u2', '2026-11-10T10:00:00Z'), n('a1', 'approved', 'u2', '2026-11-09T10:00:00Z'), n('p-mine', 'pending', 'u1', '2026-11-10T11:00:00Z'), n('r-mine', 'rejected', 'u1', '2026-11-08T10:00:00Z'), n('r-other', 'rejected', 'u2', '2026-11-08T10:00:00Z')]
  it('futár: jóváhagyottak + a saját függő és elutasított', () => {
    const v = visibleBoxNotes(notes, 'u1', false)
    expect(v.approved.map((x) => x.id)).toEqual(['a1'])
    expect(v.pending.map((x) => x.id)).toEqual(['p-mine'])
    expect(v.rejectedMine.map((x) => x.id)).toEqual(['r-mine'])
  })
  it('vezető: minden függőt lát, időrendben', () => {
    const v = visibleBoxNotes(notes, 'm1', true)
    expect(v.pending.map((x) => x.id)).toEqual(['p-other', 'p-mine'])
    expect(v.rejectedMine).toEqual([])
  })
})
