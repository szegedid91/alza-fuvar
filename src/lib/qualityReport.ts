// Napi minőségjelentés a megbízónak (az „Utód zrt. riport” minta szerint): két blokk —
// éjszakai járat (1. kör, 23:59-es indulás, az ELŐZŐ este) és nappali járat (2. kör, 5:30) —,
// útvonalanként: rendszer szerinti és valódi indulás, járat vége, komplikációk, darabszámok.
// Forrás: beosztás (ki melyik járaton volt), jelzések (Kiindultam / Járat kész / Elszámoltam /
// Hiba) és a Box-lapok megállói.
import { downloadStyledXlsx, type XCell, type XSheet, type XStyle } from './styledXlsx'

export interface QRoute { id: string; code: string; active: boolean; is_relief: boolean }
export interface QShift { work_date: string; round: number | null; route_id: string | null; driver_id: string | null; loader_id: string | null }
export interface QEvent { user_id: string; kind: string; at: string; note: string | null }
export interface QSheet {
  id: string; user_id: string; created_at: string; end_time: string | null
  comp_bu: number; comp_szh: number; comp_hb: number; comp_r: number; comp_note: string | null
  wh_crates_no_label: number; wh_packages_no_label: number; wh_pallet_items: number; wh_note: string | null
}
export interface QStop {
  sheet_id: string; done_at: string | null; created_at: string; box_code: string | null; box_name: string | null; note: string | null
  missorted: number; nf: number; oversize: number; shortage: number; returned: number; left_on_car: number
  // nem behelyezett csomagok okai: ÉK (érvénytelen kód), NHB (ne helyezd be), törölt; damaged = a régi összevont mező
  invalid_code?: number; do_not_place?: number; cancelled?: number; damaged?: number
}

export type QBlockKind = 'night' | 'day'
// 1. kör = éjszakai (DPO), 2. kör = nappali (SD) — a rendszer szerinti indulás a megbízó mintájából
export const BLOCKS: Record<QBlockKind, { round: number; planned: string; title: string }> = {
  night: { round: 1, planned: '23:59', title: 'éjszakai járat' },
  day: { round: 2, planned: '05:30', title: 'nappali járat' },
}

export interface QRow {
  label: string
  planned: string // 'HH:MM'
  staffed: boolean // volt-e beosztva ember erre a járatra
  departed: string | null // valódi indulás 'HH:MM'
  ended: string | null // járat vége 'HH:MM'
  endedFromSheet: boolean // nincs „Járat kész” jelzés → a Box-lap végzési ideje
  settled: string | null
  complications: string
  hasSheet: boolean // van-e Box-lap adat (enélkül a darabszámok üresek, nem 0-k)
  missorted: number | null
  noFit: number | null
  shortage: number | null
  returned: number | null
  undelivered: number | null
  note: string
}
export interface QBlock { kind: QBlockKind; date: string; title: string; rows: QRow[]; unrouted: number }
export interface QReport { day: string; night: QBlock; dayBlock: QBlock }

const H = 3600_000
const pad = (n: number) => String(n).padStart(2, '0')
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(y, m - 1, d + n)
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}
// helyi idő szerinti időpont (a jelentést helyben, magyar időben készítik)
export const localAt = (iso: string, hm: string): number => new Date(`${iso}T${hm}:00`).getTime()
const hmOf = (ms: number): string => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
export const huDate = (iso: string): string => `${iso.slice(0, 4)}.${iso.slice(5, 7)}.${iso.slice(8, 10)}.`
// 'HH:MM' → Excel-időérték (a nap törtrésze)
export const timeFraction = (hm: string): number => { const [h, m] = hm.split(':').map(Number); return (h * 60 + m) / 1440 }

const startOf = (workDate: string, round: number): number => localAt(workDate, round === 2 ? BLOCKS.day.planned : BLOCKS.night.planned)
const slotKey = (workDate: string, round: number) => `${workDate}|${round === 2 ? 2 : 1}`

// Egy munkatárs körei és az időablak, amelyben a jelzései / megállói az adott körhöz tartoznak.
// A jelzésnek nincs kör-mezője, és az éjszakai kör átnyúlik a következő naptári napra, ezért
// időből döntünk: a kör indulása előtt 6 órától utána 18 óráig; ha ugyanannak az embernek
// közben másik köre is van, a határ a következő indulás előtt van (a két indulás távolságától függően).
export interface Slot { key: string; start: number; lo: number; hi: number }
export function userSlots(shifts: QShift[]): Map<string, Slot[]> {
  const byUser = new Map<string, Map<string, Slot>>()
  for (const s of shifts) {
    const round = s.round === 2 ? 2 : 1
    for (const u of [s.driver_id, s.loader_id]) {
      if (!u) continue
      if (!byUser.has(u)) byUser.set(u, new Map())
      const key = slotKey(s.work_date, round)
      const start = startOf(s.work_date, round)
      byUser.get(u)!.set(key, { key, start, lo: start - 6 * H, hi: start + 18 * H })
    }
  }
  const out = new Map<string, Slot[]>()
  for (const [u, m] of byUser) {
    const list = [...m.values()].sort((a, b) => a.start - b.start)
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i]; const b = list[i + 1]
      if (a.hi <= b.lo) continue
      const lead = Math.min(6 * H, Math.max(0.75 * H, (b.start - a.start) / 8))
      a.hi = b.lo = b.start - lead
    }
    out.set(u, list)
  }
  return out
}

// több tétel egy cellában: soronként egy (a cella sortöréses)
const plural = (parts: (string | null | false | undefined)[], sep = '\n'): string => parts.filter((x): x is string => !!x && x.trim() !== '').join(sep)

export function buildQualityReport(day: string, routes: QRoute[], shifts: QShift[], events: QEvent[], sheets: QSheet[], stops: QStop[], prefix = ''): QReport {
  const slots = userSlots(shifts)
  const label = (code: string) => (prefix.trim() ? `${prefix.trim()} ${code}` : code)
  const sheetsById = new Map(sheets.map((s) => [s.id, s]))
  const eventsOf = new Map<string, { kind: string; at: number; note: string | null }[]>()
  for (const e of events) {
    if (!eventsOf.has(e.user_id)) eventsOf.set(e.user_id, [])
    eventsOf.get(e.user_id)!.push({ kind: e.kind, at: new Date(e.at).getTime(), note: e.note })
  }
  for (const l of eventsOf.values()) l.sort((a, b) => a.at - b.at)

  function block(kind: QBlockKind, date: string): QBlock {
    const meta = BLOCKS[kind]
    const mine = shifts.filter((s) => s.work_date === date && (s.round === 2 ? 2 : 1) === meta.round && (s.driver_id || s.loader_id))
    const used = new Set(mine.map((s) => s.route_id).filter((x): x is string => !!x))
    const listed = routes.filter((r) => used.has(r.id) || (r.active && !r.is_relief)).sort((a, b) => a.code.localeCompare(b.code, 'hu'))
    const known = new Set(listed.map((r) => r.id))
    const key = slotKey(date, meta.round)

    const rows = listed.map((r): QRow => {
      const rs = mine.filter((s) => s.route_id === r.id)
      const drivers = [...new Set(rs.map((s) => s.driver_id).filter((x): x is string => !!x))]
      const loaders = [...new Set(rs.map((s) => s.loader_id).filter((x): x is string => !!x))].filter((u) => !drivers.includes(u))
      const windowOf = (u: string) => slots.get(u)?.find((s) => s.key === key) ?? null
      const inWin = (u: string, t: number) => { const w = windowOf(u); return !!w && t >= w.lo && t < w.hi }
      const evs = (users: string[], k: string) => users.flatMap((u) => (eventsOf.get(u) ?? []).filter((e) => e.kind === k && inWin(u, e.at)))
      // a sofőr jelzése az irányadó; ha nincs, a rakodóé
      const pick = (k: string, which: 'first' | 'last'): number | null => {
        for (const group of [drivers, loaders]) {
          const l = evs(group, k).map((e) => e.at)
          if (l.length) return which === 'first' ? Math.min(...l) : Math.max(...l)
        }
        return null
      }
      const crew = [...drivers, ...loaders]
      const departed = pick('departed', 'first')
      const done = pick('done', 'last')
      const settled = pick('settled', 'last')
      const issues = evs(crew, 'issue').sort((a, b) => a.at - b.at)

      const crewSheets = sheets.filter((s) => crew.includes(s.user_id))
      const myStops = stops.filter((st) => { const sh = sheetsById.get(st.sheet_id); return !!sh && crew.includes(sh.user_id) && inWin(sh.user_id, new Date(st.done_at ?? st.created_at).getTime()) })
      const stopSheetIds = new Set(myStops.map((st) => st.sheet_id))
      // a lap szintű mezők (nap végi összesítők) ahhoz a körhöz tartoznak, amelyikben a lap készült vagy megállója van
      const mySheets = crewSheets.filter((s) => stopSheetIds.has(s.id) || inWin(s.user_id, new Date(s.created_at).getTime()))
      const hasSheet = mySheets.length > 0
      const sum = (f: (s: QStop) => number) => myStops.reduce((x, s) => x + (Number(f(s)) || 0), 0)
      const sumSheet = (f: (s: QSheet) => number) => mySheets.reduce((x, s) => x + (Number(f(s)) || 0), 0)
      const nf = sum((s) => s.nf); const oversize = sum((s) => s.oversize)
      const leftOnCar = sum((s) => s.left_on_car)
      const invalidCode = sum((s) => s.invalid_code ?? 0); const doNotPlace = sum((s) => s.do_not_place ?? 0); const cancelled = sum((s) => s.cancelled ?? 0); const legacy = sum((s) => s.damaged ?? 0)
      const damaged = invalidCode + doNotPlace + cancelled + legacy

      const sheetEnd = mySheets.map((s) => s.end_time).filter((x): x is string => !!x).map((t) => t.slice(0, 5)).sort().pop() ?? null
      const comp = (n: number, text: string) => (n > 0 ? `${text}: ${n}` : null)
      const complications = plural([
        ...issues.map((e) => `${hmOf(e.at)} ${e.note?.trim() || 'hiba jelezve'}`),
        comp(sumSheet((s) => s.comp_bu), 'Box újraindítás'),
        comp(sumSheet((s) => s.comp_szh), 'Szkenner hiba'),
        comp(sumSheet((s) => s.comp_hb), 'Nem tölthető box (db)'),
        comp(sumSheet((s) => s.comp_r), 'Redphonra bejelentve'),
        ...mySheets.map((s) => s.comp_note?.trim()),
      ])
      const crates = sumSheet((s) => s.wh_crates_no_label); const pkgs = sumSheet((s) => s.wh_packages_no_label)
      const note = plural([
        settled !== null ? `Elszámolás: ${hmOf(settled)}` : null,
        nf > 0 && oversize > 0 ? `Nem fért be: nincs szabad fiók ${nf}, túlméretes ${oversize}` : null,
        damaged > 0 ? `Nem szállított: ${plural([leftOnCar > 0 ? `autón maradt ${leftOnCar}` : null, invalidCode > 0 ? `érvénytelen kód ${invalidCode}` : null, doNotPlace > 0 ? `ne helyezd be ${doNotPlace}` : null, cancelled > 0 ? `törölt ${cancelled}` : null, legacy > 0 ? `ÉK/NHB/törölt (régi) ${legacy}` : null], ', ')}` : null,
        crates > 0 ? `Láda címke nélkül: ${crates}${pkgs > 0 ? ` (benne ${pkgs} csomag)` : ''}` : null,
        comp(sumSheet((s) => s.wh_pallet_items), 'Raklapos, nem behelyezhető'),
        ...mySheets.map((s) => s.wh_note?.trim()),
        ...myStops.filter((s) => s.note?.trim()).map((s) => `${s.box_code ?? s.box_name ?? 'box'}: ${s.note!.trim()}`),
      ])

      return {
        label: label(r.code), planned: meta.planned, staffed: rs.length > 0,
        departed: departed !== null ? hmOf(departed) : null,
        ended: done !== null ? hmOf(done) : sheetEnd, endedFromSheet: done === null && sheetEnd !== null,
        settled: settled !== null ? hmOf(settled) : null,
        complications, hasSheet,
        missorted: hasSheet ? sum((s) => s.missorted) : null,
        noFit: hasSheet ? nf + oversize : null,
        shortage: hasSheet ? sum((s) => s.shortage) : null,
        returned: hasSheet ? sum((s) => s.returned) : null,
        undelivered: hasSheet ? leftOnCar + damaged : null,
        note,
      }
    })
    const unrouted = mine.filter((s) => !s.route_id || !known.has(s.route_id)).length
    return { kind, date, title: `${huDate(date)} Minőség jelentés - ${meta.title}`, rows, unrouted }
  }

  // a nappali járat a jelentés napján megy, az éjszakai az előző este indul (mint a mintában: 10.25. / 10.26.)
  return { day, night: block('night', addDays(day, -1)), dayBlock: block('day', day) }
}

// ---- Formázott tábla a minta színeivel ----
const GREEN = 'B6D7A8'; const ORANGE = 'FF9900'; const YELLOW = 'FFFF00'; const BLUE = 'C9DAF8'; const GRAY = 'CCCCCC'; const TITLE = 'D8D8D8'
const HEAD = [
  'Útvonal', 'Az útvonal indulásának az ideje rendszer szerint', 'Valódi indulási idő', 'Útvonal vége',
  'Komplikációk az útvonalon - a késés oka', 'Rosszul szortírozott áru (elkevert) db', 'Nem fért be az AlzaBoxba (db)',
  'Hiányzó áru (db)', 'Visszáru (db)', 'Nem szállított valamilyen okból (db)', 'Megjegyzés',
]
const FILLS = [GREEN, ORANGE, ORANGE, YELLOW, GREEN, BLUE, BLUE, BLUE, BLUE, BLUE, GRAY]
const COLS = [18.3, 13.3, 11, 10.5, 38, 12.3, 11, 10.5, 9.5, 12, 40]
const LETTERS = 'ABCDEFGHIJK'
const base: XStyle = { color: '000000', border: 'medium', h: 'center', wrap: true }

// a sortöréses cellákhoz becsült sormagasság (az író nem tud automatikus magasságot)
function rowHeight(texts: { text: string; width: number }[]): number {
  let lines = 1
  for (const { text, width } of texts) {
    const perLine = Math.max(8, Math.floor(width * 1.05))
    const n = text.split('\n').reduce((x, part) => x + Math.max(1, Math.ceil(part.length / perLine)), 0)
    lines = Math.max(lines, n)
  }
  return Math.max(18, lines * 15 + 4)
}

export function qualitySheet(report: QReport, company: string): XSheet {
  const cells: Record<string, XCell> = {}
  const merges: string[] = []
  const rowHeights: Record<number, number> = {}
  const who = company.trim()

  function put(block: QBlock, top: number): number {
    cells[`A${top}`] = { v: `${who ? `${who}: ` : ''}${block.title}`, s: { ...base, bold: true, size: 22, fill: TITLE, wrap: false } }
    for (const c of LETTERS.slice(1)) cells[`${c}${top}`] = { s: { ...base, fill: TITLE } }
    merges.push(`A${top}:K${top}`)
    rowHeights[top] = 36.75
    HEAD.forEach((h, i) => { cells[`${LETTERS[i]}${top + 1}`] = { v: h, s: { ...base, bold: true, size: i === 10 ? 11 : 12, fill: FILLS[i] } } })
    rowHeights[top + 1] = 79.5
    block.rows.forEach((r, i) => {
      const row = top + 2 + i
      const time = (hm: string | null, fill: string): XCell => (hm ? { v: timeFraction(hm), s: { ...base, bold: true, fill, numFmt: 'hh:mm' } } : { s: { ...base, fill } })
      const num = (n: number | null): XCell => (n === null ? { s: { ...base, fill: BLUE } } : { v: n, s: { ...base, fill: BLUE, numFmt: '0' } })
      const text = (t: string, fill: string): XCell => ({ v: t, s: { ...base, fill, h: 'left', size: 10 } })
      cells[`A${row}`] = { v: r.label, s: { ...base, bold: true, size: 12, fill: i % 2 === 0 ? BLUE : GREEN } }
      cells[`B${row}`] = time(r.planned, ORANGE)
      cells[`C${row}`] = time(r.departed, ORANGE)
      cells[`D${row}`] = time(r.ended, YELLOW)
      cells[`E${row}`] = text(r.complications, GREEN)
      cells[`F${row}`] = num(r.missorted)
      cells[`G${row}`] = num(r.noFit)
      cells[`H${row}`] = num(r.shortage)
      cells[`I${row}`] = num(r.returned)
      cells[`J${row}`] = num(r.undelivered)
      cells[`K${row}`] = text(r.note, GRAY)
      rowHeights[row] = rowHeight([{ text: r.complications, width: COLS[4] }, { text: r.note, width: COLS[10] }])
    })
    return top + 2 + block.rows.length
  }

  const afterNight = put(report.night, 1)
  put(report.dayBlock, afterNight + 4) // a mintában négy üres sor választja el a két blokkot
  return { name: 'Minőségjelentés', cells, merges, cols: COLS, rowHeights, landscape: true }
}

export function qualityFilename(company: string, day: string): string {
  const who = company.trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${who ? `${who} ` : ''}riport ${day}.xlsx`
}

export async function exportQualityXlsx(report: QReport, company: string): Promise<void> {
  await downloadStyledXlsx(qualitySheet(report, company), qualityFilename(company, report.day))
}
