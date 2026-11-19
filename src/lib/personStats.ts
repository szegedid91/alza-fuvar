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
