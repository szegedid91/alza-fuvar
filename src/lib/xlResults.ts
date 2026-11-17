// XL sikeres címek a megbízó havi táblázatából („ALZA_UTÓD_ééhh.xlsx”).
// A lap szerkezete: az első sorban „Dátum”, utána járatonként (UX22, UX23…) négy oszlop:
// a páros neve („Sofőr/Rakodó”), egy összevont üres oszlop, „Cím” (a nap címszáma) és „Megjegyzés”.
// A táblázat járatkódot és neveket ad, rendszámot nem — az autót a beosztásból keressük meg név szerint.

export interface XlSheetCell { date: string; route: string; names: string[]; count: number; note: string | null }
export interface XlSheetParse { cells: XlSheetCell[]; problems: string[] }

const norm = (v: unknown): string =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const pad = (n: number) => String(n).padStart(2, '0')

// Excel-dátum → 'YYYY-MM-DD'. Sorszám (1900-as rendszer), Date, vagy szöveg: 2026.10.01. / 2026-10-01 / 10/1/26
export function sheetDateISO(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v < 20000 || v > 80000) return null // 1954 és 2119 között: ami ezen kívül esik, az nem dátum
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // a táblázatkezelő helyi éjfélt ad: fél nap ráhagyással az időzóna nem tolja át a napot
    const d = new Date(v.getTime() + 12 * 3_600_000)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/) // amerikai forma: hónap/nap/év
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2])
  return null
}
function valid(y: number, mo: number, d: number): string | null {
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : null
}

function countOf(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 999 ? n : null
}

// Egy munkalap sorai (cellaértékek tömbje) → napi címszámok járatonként
export function parseXlSheet(rows: unknown[][]): XlSheetParse {
  const cells: XlSheetCell[] = []
  const problems: string[] = []
  const hi = rows.findIndex((r) => (r ?? []).some((c) => norm(c) === 'datum'))
  if (hi < 0) return { cells, problems: ['Nem találom a „Dátum” fejlécet a lapon.'] }
  const head = rows[hi] ?? []
  const dateCol = head.findIndex((c) => norm(c) === 'datum')
  const reserved = new Set(['datum', 'cim', 'megjegyzes', ''])
  // járat-blokkok: minden „Cím” oszlophoz a tőle balra eső legközelebbi járatfelirat tartozik
  const blocks: { route: string; nameCol: number; countCol: number; noteCol: number | null }[] = []
  head.forEach((c, j) => {
    if (norm(c) !== 'cim') return
    let k = j - 1
    while (k > dateCol && reserved.has(norm(head[k]))) k--
    if (k <= dateCol) { problems.push(`A(z) ${j + 1}. oszlop „Cím” fejlécéhez nem találok járatot.`); return }
    blocks.push({ route: String(head[k]).trim(), nameCol: k, countCol: j, noteCol: norm(head[j + 1]) === 'megjegyzes' ? j + 1 : null })
  })
  if (blocks.length === 0) return { cells, problems: ['Nem találok „Cím” oszlopot a lapon.'] }
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    if (r[dateCol] == null || r[dateCol] === '') continue
    const date = sheetDateISO(r[dateCol])
    if (!date) { if (blocks.some((b) => r[b.countCol] != null && r[b.countCol] !== '')) problems.push(`${i + 1}. sor: nem értelmezhető dátum (${String(r[dateCol])}).`); continue }
    for (const b of blocks) {
      const raw = r[b.countCol]
      if (raw == null || raw === '') continue // aznap nem ment ez a járat, vagy még nincs beírva a szám
      const count = countOf(raw)
      if (count == null) { problems.push(`${date} ${b.route}: a címszám nem egész szám (${String(raw)}).`); continue }
      const names = String(r[b.nameCol] ?? '').split('/').map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean)
      const note = b.noteCol != null && r[b.noteCol] != null && String(r[b.noteCol]).trim() ? String(r[b.noteCol]).trim() : null
      cells.push({ date, route: b.route, names, count, note })
    }
  }
  return { cells, problems }
}

// ---- Párosítás a beosztással: melyik XL autóé a táblázat egy sora ----
export interface XlShiftLike { work_date: string; car_id: string; plate: string; people: { id: string | null; name: string | null; driver: boolean }[] }
export interface XlMatch { cell: XlSheetCell; car_id: string; plate: string; partial: boolean }
export interface XlUnmatched { cell: XlSheetCell; reason: string }

// Két név azonos-e: ékezet, kis- és nagybetű, szóközök és a szavak sorrendje nem számít
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = norm(a), y = norm(b)
  if (!x || !y) return false
  return x === y || x.split(' ').sort().join(' ') === y.split(' ').sort().join(' ')
}

// A táblázat első neve a sofőr: az ő autója az erősebb jel (a rakodók a valóságban gyakrabban cserélődnek).
export function matchXlCells(cells: XlSheetCell[], shifts: XlShiftLike[]): { matched: XlMatch[]; unmatched: XlUnmatched[] } {
  const byDate = new Map<string, XlShiftLike[]>()
  for (const s of shifts) byDate.set(s.work_date, [...(byDate.get(s.work_date) ?? []), s])
  const matched: XlMatch[] = []
  const unmatched: XlUnmatched[] = []
  const taken = new Map<string, { score: number; idx: number }>() // car|date → a legjobb találat
  for (const cell of cells) {
    if (cell.names.length === 0) { unmatched.push({ cell, reason: 'nincs név a táblázatban' }); continue }
    const cands = byDate.get(cell.date) ?? []
    if (cands.length === 0) { unmatched.push({ cell, reason: 'erre a napra nincs XL beosztás' }); continue }
    const scored = cands.map((s) => {
      let score = 0, hits = 0
      cell.names.forEach((n, i) => {
        const p = s.people.find((x) => sameName(x.name, n))
        if (!p) return
        hits++
        score += i === 0 && p.driver ? 2 : 1
      })
      return { s, score, hits }
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
    if (scored.length === 0) { unmatched.push({ cell, reason: 'a nevek aznap egyik XL autón sem szerepelnek' }); continue }
    if (scored.length > 1 && scored[0].score === scored[1].score) { unmatched.push({ cell, reason: `több autó is illik (${scored.slice(0, 2).map((x) => x.s.plate).join(', ')})` }); continue }
    const best = scored[0]
    const key = `${best.s.car_id}|${cell.date}`
    const prev = taken.get(key)
    const entry: XlMatch = { cell, car_id: best.s.car_id, plate: best.s.plate, partial: best.hits < cell.names.length }
    if (prev) {
      // ugyanarra az autóra két sor jutna: az erősebb marad, a másik kézzel rendezendő
      if (best.score > prev.score) {
        unmatched.push({ cell: matched[prev.idx].cell, reason: `${best.s.plate}: erre az autóra egy másik sor jobban illik` })
        matched[prev.idx] = entry
        taken.set(key, { score: best.score, idx: prev.idx })
      } else unmatched.push({ cell, reason: `${best.s.plate}: erre az autóra már jutott egy sor` })
      continue
    }
    taken.set(key, { score: best.score, idx: matched.length })
    matched.push(entry)
  }
  return { matched, unmatched }
}
