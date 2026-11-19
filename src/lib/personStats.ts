// Egy munkatárs adatlapjának számításai (tiszta függvények): havi bér és napok, munkaidő, autók, XL eredmények.
// A bér ugyanazzal a számítással készül, mint a Bér oldalon (payrollDays + buildDayComps + payForDay),
// havonta az adott hónapra érvényes díjjal.
import { buildDayComps, payForDay, payrollDays, rateSetOf, type AdvanceBasis, type RateSet, type XlResultLike } from './payroll'

export interface PShift {
  work_date: string; workspace_id: string; car_id: string; round: number | null; is_box: boolean | null
  driver_id: string | null; loader_id: string | null; trainee_id: string | null; plate: string; route: string | null
}
export interface PCheckin {
  user_id: string; work_date: string; workspace_id: string
  first_checked_in_at: string | null; checked_in_at: string; checked_out_at: string | null
  outside_geofence: boolean | null; out_outside_geofence: boolean | null; prev_car_id: string | null
}
export interface PAdjustment { type: string; amount: number | string; work_date: string; paid_on: string | null; reason: string | null }
type RateCols = Parameters<typeof rateSetOf>[0]
export type WsRate = RateCols & { id: string }
export type RateRow = RateCols & { workspace_id: string; valid_from: string }

// 'YYYY-MM-DD' kezdet és (kizáró) vég között a hónapok: ['2026-06', '2026-07', …]
export function monthsOf(start: string, endExclusive: string): string[] {
  const out: string[] = []
  let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7))
  const end = endExclusive.slice(0, 7)
  for (let guard = 0; guard < 240; guard++) {
    const ym = `${y}-${String(m).padStart(2, '0')}`
    if (ym >= end && !(ym === end && endExclusive.slice(8, 10) !== '01')) break
    out.push(ym)
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}

// A hónapra érvényes díj: a hónap kezdetéig hatályba lépett utolsó díjsor; ha nincs, a munkaterület jelenlegi díja
export function rateResolver(workspaces: WsRate[], history: RateRow[]): (wsId: string, ym: string) => RateSet | undefined {
  const sorted = [...history].sort((a, b) => a.valid_from.localeCompare(b.valid_from))
  return (wsId, ym) => {
    let row: RateCols | undefined = workspaces.find((w) => w.id === wsId)
    for (const h of sorted) if (h.workspace_id === wsId && h.valid_from <= `${ym}-01`) row = h
    return row ? rateSetOf(row) : undefined
  }
}

export interface MonthRow {
  ym: string
  days: number; xlDays: number; boxDays: number; traineeDays: number; bonusDays: number
  xlPay: number; boxPay: number; bonusPay: number; base: number
  advances: number; deductions: number; payout: number
  futureDays: number
}

export function buildMonthRows(a: {
  userId: string; months: string[]; basis: AdvanceBasis; today: string
  checkins: PCheckin[]; shifts: PShift[]; xlResults: XlResultLike[]; adjustments: PAdjustment[]
  rateOf: (wsId: string, ym: string) => RateSet | undefined
}): MonthRow[] {
  const rows = new Map<string, MonthRow>(a.months.map((ym) => [ym, {
    ym, days: 0, xlDays: 0, boxDays: 0, traineeDays: 0, bonusDays: 0, xlPay: 0, boxPay: 0, bonusPay: 0, base: 0, advances: 0, deductions: 0, payout: 0, futureDays: 0,
  }]))
  const comps = buildDayComps(a.shifts, a.xlResults)
  const { paid, future } = payrollDays(a.basis, a.checkins, a.shifts, a.today)
  for (const [date, wsId] of paid.get(a.userId) ?? []) {
    const r = rows.get(date.slice(0, 7))
    if (!r) continue
    const d = payForDay(comps.get(`${a.userId}|${date}`), a.rateOf(wsId, date.slice(0, 7)))
    const xl = (d.driver ?? 0) + (d.loader ?? 0) + (d.trainee ?? 0)
    const box = (d.box ?? 0) + (d.box2 ?? 0) + (d.boxTrainee ?? 0)
    r.days++
    if (d.driver != null || d.loader != null || d.trainee != null) r.xlDays++
    if (d.box != null || d.boxTrainee != null) r.boxDays++
    if (d.trainee != null || d.boxTrainee != null) r.traineeDays++
    if (d.xlBonus != null) { r.bonusDays++; r.bonusPay += d.xlBonus }
    r.xlPay += xl; r.boxPay += box; r.base += d.rate
  }
  for (const [date] of future.get(a.userId) ?? []) { const r = rows.get(date.slice(0, 7)); if (r) r.futureDays++ }
  for (const x of a.adjustments) {
    const r = rows.get(x.work_date.slice(0, 7))
    if (!r) continue
    if (x.type === 'advance') r.advances += Number(x.amount); else r.deductions += Number(x.amount)
  }
  for (const r of rows.values()) r.payout = r.base - r.advances - r.deductions
  return a.months.map((ym) => rows.get(ym)!)
}

// Napi munkaidő órában: a nap első becsekkolásától az utolsó kijelentkezésig (autócsere = több sor ugyanarra a napra)
export function dailyHours(checkins: PCheckin[]): Map<string, number> {
  const span = new Map<string, { from: number; to: number }>()
  for (const c of checkins) {
    if (!c.checked_out_at) continue
    const from = new Date(c.first_checked_in_at ?? c.checked_in_at).getTime(), to = new Date(c.checked_out_at).getTime()
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue
    const s = span.get(c.work_date)
    span.set(c.work_date, s ? { from: Math.min(s.from, from), to: Math.max(s.to, to) } : { from, to })
  }
  const out = new Map<string, number>()
  for (const [d, s] of span) { const h = (s.to - s.from) / 3_600_000; if (h > 0 && h <= 24) out.set(d, h) }
  return out
}

export function monthlyAvgHours(months: string[], hours: Map<string, number>): { ym: string; avg: number | null; days: number }[] {
  return months.map((ym) => {
    const v = [...hours].filter(([d]) => d.startsWith(ym)).map(([, h]) => h)
    return { ym, avg: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null, days: v.length }
  })
}

// A beosztott napok autónként (a mai napig), a legtöbbet használt elöl
export function carDays(shifts: PShift[], today: string): { plate: string; days: number }[] {
  const by = new Map<string, Set<string>>()
  for (const s of shifts) { if (s.work_date > today) continue; if (!by.has(s.plate)) by.set(s.plate, new Set()); by.get(s.plate)!.add(s.work_date) }
  return [...by].map(([plate, d]) => ({ plate, days: d.size })).sort((x, y) => y.days - x.days || x.plate.localeCompare(y.plate))
}

// Az XL napok sikeres címszámai (sofőrként vagy rakodóként; betanulóként nem számít)
export function xlSeries(shifts: PShift[], results: XlResultLike[], userId: string, today: string): { date: string; count: number; plate: string }[] {
  const of = new Map(results.map((r) => [`${r.car_id}|${r.work_date}`, Number(r.success_count)]))
  const out = new Map<string, { date: string; count: number; plate: string }>()
  for (const s of shifts) {
    if (s.is_box || s.work_date > today || (s.driver_id !== userId && s.loader_id !== userId)) continue
    const c = of.get(`${s.car_id}|${s.work_date}`)
    if (c == null) continue
    const prev = out.get(s.work_date)
    if (!prev || c > prev.count) out.set(s.work_date, { date: s.work_date, count: c, plate: s.plate })
  }
  return [...out.values()].sort((x, y) => x.date.localeCompare(y.date))
}

// Megbízhatóság: a mai napig beosztott napok, ebből becsekkolás nélkül maradtak
export function attendance(shifts: PShift[], checkins: PCheckin[], today: string): { assigned: number; worked: number; missed: string[] } {
  const assigned = new Set(shifts.filter((s) => s.work_date <= today).map((s) => s.work_date))
  const worked = new Set(checkins.map((c) => c.work_date))
  return { assigned: assigned.size, worked: worked.size, missed: [...assigned].filter((d) => !worked.has(d) && d < today).sort() }
}

// ---- Pontosság: a „Kiindultam” jelzés a járat tervezett indulásához képest ----
export interface PEvent { work_date: string; kind: string; at: string }
export interface Departure { date: string; round: number; route: string | null; planned: string; actual: string; lateMin: number }
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
// Két óra:perc különbsége percben a ±12 órás sávban (az éjszakai indulás átlóg az éjfélen)
export function minutesApart(planned: string, actual: string): number {
  let d = (((toMin(actual) - toMin(planned)) % 1440) + 1440) % 1440
  if (d > 720) d -= 1440
  return d
}
// A Box-járatok tervezett indulása körönként (a megbízó rendje): 1. kör 23:59 (előző este), 2. kör 05:30.
// A járat betöltött tervének indulása csak arra a körre érvényes, amelyikre a terv szól.
export function plannedStartOf(round: number, routePlannedStart: string | null): string {
  const def = round === 2 ? '05:30' : '23:59'
  if (!routePlannedStart) return def
  const h = Number(routePlannedStart.slice(0, 2))
  const planRound = h >= 3 && h < 15 ? 2 : 1
  return planRound === round ? routePlannedStart.slice(0, 5) : def
}
// Naponként a Box-körök (kör szerint) és a „Kiindultam” jelzések (idő szerint) párba állítva
export function departures(shifts: (PShift & { planned_start?: string | null })[], events: PEvent[], userId: string): Departure[] {
  const out: Departure[] = []
  const byDate = new Map<string, PEvent[]>()
  for (const e of events) if (e.kind === 'departed') byDate.set(e.work_date, [...(byDate.get(e.work_date) ?? []), e])
  for (const [date, evs] of byDate) {
    const rounds = shifts.filter((s) => s.work_date === date && s.is_box && (s.driver_id === userId || s.loader_id === userId))
      .sort((a, b) => (a.round ?? 1) - (b.round ?? 1))
    evs.sort((a, b) => a.at.localeCompare(b.at)).forEach((e, i) => {
      const s = rounds[i]
      if (!s) return
      const planned = plannedStartOf(s.round ?? 1, s.planned_start ?? null)
      const actual = hm(new Date(e.at))
      out.push({ date, round: s.round ?? 1, route: s.route, planned, actual, lateMin: minutesApart(planned, actual) })
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.round - b.round)
}

// ---- Járat-tempó: a box-megállók naplójából ----
export interface PStopLog { work_date: string; route_id: string | null; round: number | null; done_at: string | null; late_minutes: number | null; delay_reason: string | null }
export interface Tempo {
  runs: { date: string; round: number; stops: number; minutes: number }[]
  stops: number; lateStops: number; avgPerStop: number | null; avgLate: number | null
  reasons: { label: string; value: number }[]
}
export function routeTempo(logs: PStopLog[]): Tempo {
  const groups = new Map<string, PStopLog[]>()
  for (const l of logs) { const k = `${l.work_date}|${l.route_id ?? ''}|${l.round ?? 1}`; groups.set(k, [...(groups.get(k) ?? []), l]) }
  const runs: Tempo['runs'] = []
  let gapMin = 0, gaps = 0
  for (const g of groups.values()) {
    const t = g.map((x) => (x.done_at ? new Date(x.done_at).getTime() : NaN)).filter(Number.isFinite).sort((a, b) => a - b)
    if (t.length < 2) { runs.push({ date: g[0].work_date, round: g[0].round ?? 1, stops: g.length, minutes: 0 }); continue }
    // a megállók közti idő; a két óránál hosszabb szünet (pl. raktárra várás két kör között) nem a tempó része
    for (let i = 1; i < t.length; i++) { const m = (t[i] - t[i - 1]) / 60000; if (m <= 120) { gapMin += m; gaps++ } }
    runs.push({ date: g[0].work_date, round: g[0].round ?? 1, stops: g.length, minutes: Math.round((t[t.length - 1] - t[0]) / 60000) })
  }
  const late = logs.filter((l) => Number(l.late_minutes ?? 0) > 0)
  const reasons = new Map<string, number>()
  for (const l of late) { const k = l.delay_reason?.trim() || 'Nincs megadva'; reasons.set(k, (reasons.get(k) ?? 0) + 1) }
  return {
    runs: runs.sort((a, b) => a.date.localeCompare(b.date) || a.round - b.round),
    stops: logs.length, lateStops: late.length, avgPerStop: gaps ? gapMin / gaps : null,
    avgLate: late.length ? late.reduce((s, l) => s + Number(l.late_minutes), 0) / late.length : null,
    reasons: [...reasons].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
  }
}

// Előlegek havonta (minden idők): az első előleg hónapjától a mai hónapig, hézag nélkül
export function advancesByMonth(adjustments: PAdjustment[], todayYm: string): { ym: string; amount: number; count: number }[] {
  const adv = adjustments.filter((a) => a.type === 'advance')
  if (adv.length === 0) return []
  const ymOf = (a: PAdjustment) => (a.paid_on ?? a.work_date).slice(0, 7)
  const first = adv.map(ymOf).sort()[0]
  const [y, m] = todayYm.split('-').map(Number)
  const months = monthsOf(`${first}-01`, `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`)
  return months.map((ym) => { const v = adv.filter((a) => ymOf(a) === ym); return { ym, amount: v.reduce((s, a) => s + Number(a.amount), 0), count: v.length } })
}
