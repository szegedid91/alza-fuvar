import { describe, it, expect } from 'vitest'
import { buildRoundsTable, roundsSheetModel, daysOfMonth, excelSerial, NO_ROUTE_LABEL, type RoundShift } from './roundsExport'

const routes = [
  { id: 'r', code: 'R', active: true, is_relief: false },
  { id: 'g', code: 'G', active: true, is_relief: false },
  { id: 'i', code: 'I', active: true, is_relief: false },
  { id: 'x', code: 'X', active: true, is_relief: true },
  { id: 'old', code: 'Z', active: false, is_relief: false },
]
const sh = (work_date: string, route_id: string | null, round: number, extra: Partial<RoundShift> = {}): RoundShift => ({ work_date, route_id, round, staffed: true, isBox: true, ...extra })

describe('buildRoundsTable — napi járatszám útvonalanként (DPO = 1. kör, SD = 2. kör)', () => {
  const shifts = [
    sh('2026-10-20', 'g', 1), sh('2026-10-20', 'i', 1), sh('2026-10-20', 'r', 1),
    sh('2026-10-21', 'g', 1), sh('2026-10-21', 'g', 2), sh('2026-10-21', 'i', 1), sh('2026-10-21', 'r', 2),
    sh('2026-10-22', null, 1, { isBox: false }), // XL beosztás járat nélkül — nem kör
    sh('2026-10-22', 'g', 1, { staffed: false }), // üres sor — nem járat
    sh('2026-11-01', 'g', 1), // másik hónap
  ]
  const t = buildRoundsTable('2026-10', routes, shifts, 'Budapest')
  it('sorok: aktív, nem kisegítő járatok betűrendben, előtaggal', () => {
    expect(t.rows.map((r) => r.label)).toEqual(['Budapest G', 'Budapest I', 'Budapest R'])
    expect(t.days).toHaveLength(31)
  })
  it('napi darabszám körönként; járatos napon a 0 is kiíródik, máskor üres', () => {
    const g = t.rows[0]; const r = t.rows[2]
    expect([g.dpo[19], g.sd[19], g.dpo[20], g.sd[20]]).toEqual([1, 0, 1, 1])
    expect([r.dpo[20], r.sd[20]]).toEqual([0, 1])
    expect(g.dpo[0]).toBeNull()
    expect(g.dpo[21]).toBeNull() // 10-22: csak nem számító sorok
  })
  it('összesítés', () => {
    expect(t.rows.map((r) => [r.dpoTotal, r.sdTotal])).toEqual([[2, 1], [2, 0], [1, 1]])
    expect([t.dpoTotal, t.sdTotal]).toEqual([5, 2])
  })
  it('kisegítő/inaktív járat csak akkor sor, ha ment; járat nélküli Box-kör külön sorba kerül', () => {
    const t2 = buildRoundsTable('2026-10', routes, [sh('2026-10-05', 'x', 1), sh('2026-10-05', null, 2), sh('2026-10-05', 'deleted', 1)], '')
    expect(t2.rows.map((r) => r.label)).toEqual(['G', 'I', 'R', 'X', NO_ROUTE_LABEL])
    expect(t2.rows[4]).toMatchObject({ dpoTotal: 1, sdTotal: 1 })
  })
})

describe('roundsSheetModel — a minta elrendezése (B2-től, naponként DPO/SD oszloppár)', () => {
  const t = buildRoundsTable('2026-10', routes, [sh('2026-10-20', 'g', 1), sh('2026-10-20', 'g', 2), sh('2026-10-21', 'i', 1)], 'Budapest')
  const m = roundsSheetModel(t)
  it('fejléc: dátum két összevont oszlop felett, alatta DPO Db / SD Db', () => {
    expect(m.cells.B2.v).toBe('Db'); expect(m.cells.B3.v).toBe('Útvonalak')
    expect(m.cells.C2).toMatchObject({ t: 'n', v: excelSerial('2026-10-01'), z: 'yyyy-mm-dd' })
    expect(excelSerial('2026-10-01')).toBe(46296) // a mintafájl C2 cellájának értéke
    expect(m.merges).toContain('C2:D2'); expect(m.merges).toContain('BK2:BL2'); expect(m.merges).toContain('BM2:BN2')
    expect(m.cells.C3.v).toBe('DPO Db'); expect(m.cells.D3.v).toBe('SD Db')
    expect(m.cells.BM2.v).toBe('Összesen'); expect(m.cells.BN3.v).toBe('SD Db')
  })
  it('adatcellák és összesítő képletek a minta szerint', () => {
    expect(m.cells.B4.v).toBe('Budapest G')
    expect(m.cells.AO4.v).toBe(1); expect(m.cells.AP4.v).toBe(1) // 10-20 DPO / SD
    expect(m.cells.AQ4.v).toBe(0); expect(m.cells.AQ5.v).toBe(1) // 10-21
    expect(m.cells.C4).toBeUndefined()
    expect(m.cells.BM4.f).toMatch(/^SUM\(C4,E4,G4,/); expect(m.cells.BN4.f).toMatch(/^SUM\(D4,F4,H4,/)
    expect(m.cells.B7.v).toBe('Összesen')
    expect(m.cells.AO7).toMatchObject({ v: 1, f: 'IF(SUM(AO4:AO6)=0,"",SUM(AO4:AO6))' })
    expect(m.cells.C7).toMatchObject({ t: 's', v: '' })
    expect(m.cells.BM7.v).toBe(2); expect(m.cells.BN7.v).toBe(1)
    expect(m.ref).toBe('A1:BN7')
  })
  it('hónaphossz: február 28 nap', () => {
    expect(daysOfMonth('2026-02')).toHaveLength(28)
  })
})
