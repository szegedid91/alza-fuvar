// Napi járatszám-tábla (a megbízó „Alapadat táblák” formátuma): soronként egy útvonal,
// naponként két oszlop — DPO db (éjszakai indulás, nálunk az 1. kör) és SD db
// (same day, hajnali 5:30-as indulás, nálunk a 2. kör) —, a végén összesítés.
// A km-blokk szándékosan kimarad.
import { downloadStyledXlsx, type XCell, type XSheet, type XStyle } from './styledXlsx'

export interface RoundShift {
  work_date: string
  round: number | null
  route_id: string | null
  // volt-e beosztott ember (üres sor nem járat)
  staffed: boolean
  // Box-kategóriás autó (járat nélküli Box-sor is körnek számít → „járat nélkül” sor)
  isBox: boolean
}
export interface RouteLike { id: string; code: string; active: boolean; is_relief: boolean }
export interface RoundsRow { label: string; dpo: (number | null)[]; sd: (number | null)[]; dpoTotal: number; sdTotal: number }
export interface RoundsTable { ym: string; days: string[]; rows: RoundsRow[]; dpoTotal: number; sdTotal: number }

export const NO_ROUTE_LABEL = 'Járat nélkül'

export function daysOfMonth(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number)
  const n = new Date(y, m, 0).getDate()
  return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)
}

export function buildRoundsTable(ym: string, routes: RouteLike[], shifts: RoundShift[], prefix = ''): RoundsTable {
  const days = daysOfMonth(ym)
  const dayIdx = new Map(days.map((d, i) => [d, i]))
  const counted = shifts.filter((s) => s.staffed && dayIdx.has(s.work_date) && (s.route_id || s.isBox))
  // Amelyik napon egyáltalán volt járat, ott a 0 is kiíródik; a többi nap üres marad (mint a mintában)
  const activeDays = new Set(counted.map((s) => s.work_date))
  const used = new Set(counted.map((s) => s.route_id ?? ''))
  const label = (code: string) => (prefix.trim() ? `${prefix.trim()} ${code}` : code)
  const blank = () => days.map((d) => (activeDays.has(d) ? 0 : null))

  const rowOf = new Map<string, RoundsRow>()
  const listed = routes
    .filter((r) => used.has(r.id) || (r.active && !r.is_relief))
    .sort((a, b) => a.code.localeCompare(b.code, 'hu'))
  for (const r of listed) rowOf.set(r.id, { label: label(r.code), dpo: blank(), sd: blank(), dpoTotal: 0, sdTotal: 0 })
  // törölt járatra mutató vagy járat nélküli (Box) beosztás: külön sor, hogy semmi ne vesszen el
  if (counted.some((s) => !s.route_id || !rowOf.has(s.route_id))) rowOf.set('', { label: NO_ROUTE_LABEL, dpo: blank(), sd: blank(), dpoTotal: 0, sdTotal: 0 })

  for (const s of counted) {
    const row = rowOf.get(s.route_id && rowOf.has(s.route_id) ? s.route_id : '')!
    const i = dayIdx.get(s.work_date)!
    if ((s.round ?? 1) === 2) { row.sd[i] = (row.sd[i] ?? 0) + 1; row.sdTotal++ } else { row.dpo[i] = (row.dpo[i] ?? 0) + 1; row.dpoTotal++ }
  }
  const rows = [...rowOf.values()]
  return { ym, days, rows, dpoTotal: rows.reduce((x, r) => x + r.dpoTotal, 0), sdTotal: rows.reduce((x, r) => x + r.sdTotal, 0) }
}

// A tábla cellái A1-címzéssel (a minta elrendezése: B2-től indul) — az XLSX-író ebből dolgozik,
// és külön tesztelhető. Képlet: f (a gyorsítótárazott érték: v).
export type SheetCell = { v: string | number; t: 's' | 'n'; f?: string; z?: string }
export interface SheetModel { cells: Record<string, SheetCell>; merges: string[]; ref: string; cols: number[] }

function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
// 'YYYY-MM-DD' → Excel dátum-sorszám
export function excelSerial(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569
}

export function roundsSheetModel(t: RoundsTable): SheetModel {
  const cells: Record<string, SheetCell> = {}
  const merges: string[] = []
  const NUM = '0'
  const first = 4 // az első útvonal sora
  const last = first + t.rows.length - 1
  const sumRow = last + 1
  const dCol = (i: number, sd: boolean) => colName(2 + i * 2 + (sd ? 1 : 0)) // C-től, naponként 2 oszlop
  const totD = colName(2 + t.days.length * 2)
  const totS = colName(3 + t.days.length * 2)

  cells.B2 = { t: 's', v: 'Db' }
  cells.B3 = { t: 's', v: 'Útvonalak' }
  t.days.forEach((day, i) => {
    cells[`${dCol(i, false)}2`] = { t: 'n', v: excelSerial(day), z: 'yyyy-mm-dd' }
    merges.push(`${dCol(i, false)}2:${dCol(i, true)}2`)
    cells[`${dCol(i, false)}3`] = { t: 's', v: 'DPO Db' }
    cells[`${dCol(i, true)}3`] = { t: 's', v: 'SD Db' }
  })
  cells[`${totD}2`] = { t: 's', v: 'Összesen' }
  merges.push(`${totD}2:${totS}2`)
  cells[`${totD}3`] = { t: 's', v: 'DPO Db' }
  cells[`${totS}3`] = { t: 's', v: 'SD Db' }

  t.rows.forEach((row, r) => {
    const n = first + r
    cells[`B${n}`] = { t: 's', v: row.label }
    t.days.forEach((_, i) => {
      if (row.dpo[i] != null) cells[`${dCol(i, false)}${n}`] = { t: 'n', v: row.dpo[i]!, z: NUM }
      if (row.sd[i] != null) cells[`${dCol(i, true)}${n}`] = { t: 'n', v: row.sd[i]!, z: NUM }
    })
    cells[`${totD}${n}`] = { t: 'n', v: row.dpoTotal, z: NUM, f: `SUM(${t.days.map((_, i) => `${dCol(i, false)}${n}`).join(',')})` }
    cells[`${totS}${n}`] = { t: 'n', v: row.sdTotal, z: NUM, f: `SUM(${t.days.map((_, i) => `${dCol(i, true)}${n}`).join(',')})` }
  })

  if (t.rows.length > 0) {
    cells[`B${sumRow}`] = { t: 's', v: 'Összesen' }
    const sumCell = (col: string, total: number): SheetCell => {
      const f = `IF(SUM(${col}${first}:${col}${last})=0,"",SUM(${col}${first}:${col}${last}))`
      return total === 0 ? { t: 's', v: '', f } : { t: 'n', v: total, z: NUM, f }
    }
    t.days.forEach((_, i) => {
      cells[`${dCol(i, false)}${sumRow}`] = sumCell(dCol(i, false), t.rows.reduce((x, r) => x + (r.dpo[i] ?? 0), 0))
      cells[`${dCol(i, true)}${sumRow}`] = sumCell(dCol(i, true), t.rows.reduce((x, r) => x + (r.sd[i] ?? 0), 0))
    })
    cells[`${totD}${sumRow}`] = sumCell(totD, t.dpoTotal)
    cells[`${totS}${sumRow}`] = sumCell(totS, t.sdTotal)
  }
  return {
    cells, merges,
    ref: `A1:${totS}${Math.max(sumRow, 3)}`,
    cols: [2, 21, ...Array.from({ length: t.days.length * 2 + 2 }, () => 11)],
  }
}

// ---- Megjelenés: színes fejléc, hétvégék árnyalva, összesítők kiemelve, rögzített panelek ----
const C = {
  head: '0F766E', headWeekend: '475569', headText: 'FFFFFF',
  sub: 'CCFBF1', subWeekend: 'E2E8F0', subText: '134E4A',
  label: 'F8FAFC', weekend: 'F1F5F9', zero: '94A3B8', text: '0F172A',
  total: 'FEF3C7', sum: 'E2E8F0', muted: '64748B',
}
const isWeekend = (date: string): boolean => { const [y, m, d] = date.split('-').map(Number); const wd = new Date(y, m - 1, d).getDay(); return wd === 0 || wd === 6 }

// A minta elrendezése (roundsSheetModel) formázva: cím, fejlécek, minden cella szegéllyel,
// a 0 halványabb, a hétvégi napok árnyalva, az „Összesen” oszlop és sor kiemelve.
export function roundsStyledSheet(t: RoundsTable, title: string): XSheet {
  const m = roundsSheetModel(t)
  const cells: Record<string, XCell> = {}
  const first = 4
  const sumRow = first + t.rows.length
  const dCol = (i: number, sd: boolean) => colName(2 + i * 2 + (sd ? 1 : 0))
  const totD = colName(2 + t.days.length * 2); const totS = colName(3 + t.days.length * 2)
  const put = (ref: string, style: XStyle) => {
    const src = m.cells[ref]
    cells[ref] = src ? { v: src.v, f: src.f, s: style } : { s: style }
  }

  cells.B1 = { v: title, s: { bold: true, size: 14, color: C.head } }
  // fejléc: dátumok (két összevont oszlop) + DPO / SD
  put('B2', { bold: true, color: C.headText, fill: C.head, border: true, h: 'left' })
  put('B3', { bold: true, color: C.subText, fill: C.sub, border: true, h: 'left' })
  t.days.forEach((day, i) => {
    const we = isWeekend(day)
    const dateStyle: XStyle = { bold: true, size: 10, color: C.headText, fill: we ? C.headWeekend : C.head, border: true, h: 'center', numFmt: 'yyyy\\-mm\\-dd' }
    put(`${dCol(i, false)}2`, dateStyle); put(`${dCol(i, true)}2`, dateStyle)
    const subStyle: XStyle = { bold: true, size: 9, color: C.subText, fill: we ? C.subWeekend : C.sub, border: true, h: 'center' }
    put(`${dCol(i, false)}3`, subStyle); put(`${dCol(i, true)}3`, subStyle)
  })
  const totHead: XStyle = { bold: true, color: C.headText, fill: C.head, border: true, h: 'center' }
  put(`${totD}2`, totHead); put(`${totS}2`, totHead)
  const totSub: XStyle = { bold: true, size: 9, color: C.subText, fill: C.total, border: true, h: 'center' }
  put(`${totD}3`, totSub); put(`${totS}3`, totSub)

  // útvonal-sorok
  t.rows.forEach((row, r) => {
    const n = first + r
    put(`B${n}`, { bold: true, color: C.text, fill: C.label, border: true, h: 'left' })
    t.days.forEach((day, i) => {
      const fill = isWeekend(day) ? C.weekend : undefined
      for (const sd of [false, true]) {
        const v = sd ? row.sd[i] : row.dpo[i]
        put(`${dCol(i, sd)}${n}`, { color: v === 0 ? C.zero : C.text, bold: (v ?? 0) > 0, ...(fill ? { fill } : {}), border: true, h: 'center', numFmt: '0' })
      }
    })
    const tot: XStyle = { bold: true, color: C.text, fill: C.total, border: true, h: 'center', numFmt: '0' }
    put(`${totD}${n}`, tot); put(`${totS}${n}`, tot)
  })

  // összesítő sor
  if (t.rows.length > 0) {
    put(`B${sumRow}`, { bold: true, color: C.text, fill: C.sum, topBorder: true, h: 'left' })
    const sum: XStyle = { bold: true, color: C.text, fill: C.sum, topBorder: true, h: 'center', numFmt: '0' }
    t.days.forEach((_, i) => { put(`${dCol(i, false)}${sumRow}`, sum); put(`${dCol(i, true)}${sumRow}`, sum) })
    const grand: XStyle = { ...sum, fill: 'FDE68A' }
    put(`${totD}${sumRow}`, grand); put(`${totS}${sumRow}`, grand)
  }
  const legendRow = Math.max(sumRow, 3) + 2
  cells[`B${legendRow}`] = { v: 'DPO = éjszakai indulás (1. kör) · SD = same day, hajnali 5:30-as indulás (2. kör) · a szürke oszlopok hétvégi napok', s: { italic: true, size: 9, color: C.muted } }

  const rowHeights: Record<number, number> = { 1: 26, 2: 20, 3: 18 }
  for (let n = first; n <= sumRow; n++) rowHeights[n] = 20
  return {
    name: 'Alapadat táblák',
    cells, merges: m.merges,
    cols: [2, 20, ...Array.from({ length: t.days.length * 2 }, () => 7), 9.5, 9.5],
    rowHeights, freeze: { cols: 2, rows: 3 }, landscape: true, hideGrid: true,
  }
}

export async function exportRoundsXlsx(t: RoundsTable, filename: string, title: string): Promise<void> {
  await downloadStyledXlsx(roundsStyledSheet(t, title), filename)
}
