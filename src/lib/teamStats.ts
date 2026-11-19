// Csapathoz mérés: ugyanazok a mutatók a munkaterület minden emberére, az átlag és a helyezés.
// Egy mutató átlagába csak az számít bele, akinél van elég adat hozzá (különben pár megálló torzítaná).
import type { XlResultLike } from './payroll'
import { attendance, dailyHours, departures, routeTempo, xlSeries, type PCheckin, type PEvent, type PShift, type PStopLog } from './personStats'
import { unexcused, type AbsenceLike } from './peopleFlags'

export interface TeamInputs {
  shifts: (PShift & { planned_start?: string | null })[]
  checkins: PCheckin[]
  departed: (PEvent & { user_id: string })[]
  logs: (PStopLog & { user_id: string | null })[]
  // Box-lap megállók emberenként: megállók száma és a nem behelyezett csomagok összege
  sheetStops: { user_id: string; stops: number; problems: number }[]
  xl: XlResultLike[]
  absences: (AbsenceLike & { user_id: string })[]
}
export type MetricKey = 'days' | 'lateDepPct' | 'lateStopPct' | 'perStop' | 'problems100' | 'xlAvg' | 'hours' | 'missed'
export type Metrics = Partial<Record<MetricKey, number>>
const LATE_MIN = 5

export function perPersonMetrics(t: TeamInputs, today: string): Map<string, Metrics> {
  const ids = new Set<string>()
  for (const s of t.shifts) for (const u of [s.driver_id, s.loader_id, s.trainee_id]) if (u) ids.add(u)
  for (const c of t.checkins) ids.add(c.user_id)
  const out = new Map<string, Metrics>()
  for (const id of ids) {
    const shifts = t.shifts.filter((s) => s.driver_id === id || s.loader_id === id || s.trainee_id === id)
    const checkins = t.checkins.filter((c) => c.user_id === id)
    const m: Metrics = {}
    const days = new Set(shifts.filter((s) => s.work_date <= today).map((s) => s.work_date)).size
    if (days > 0) m.days = days
    const deps = departures(shifts, t.departed.filter((e) => e.user_id === id), id)
    if (deps.length >= 3) m.lateDepPct = (deps.filter((d) => d.lateMin > LATE_MIN).length / deps.length) * 100
    const tempo = routeTempo(t.logs.filter((l) => l.user_id === id))
    if (tempo.stops >= 10) m.lateStopPct = (tempo.lateStops / tempo.stops) * 100
    if (tempo.avgPerStop != null && tempo.stops >= 10) m.perStop = tempo.avgPerStop
    const sh = t.sheetStops.filter((x) => x.user_id === id)
    const stops = sh.reduce((s, x) => s + x.stops, 0)
    if (stops >= 10) m.problems100 = (sh.reduce((s, x) => s + x.problems, 0) / stops) * 100
    const xl = xlSeries(shifts, t.xl, id, today)
    if (xl.length >= 3) m.xlAvg = xl.reduce((s, x) => s + x.count, 0) / xl.length
    const hours = [...dailyHours(checkins).values()]
    if (hours.length >= 3) m.hours = hours.reduce((s, x) => s + x, 0) / hours.length
    if (checkins.length > 0) m.missed = unexcused(attendance(shifts, checkins, today).missed, t.absences.filter((a) => a.user_id === id)).length
    out.set(id, m)
  }
  return out
}

export interface CompareRow { key: MetricKey; label: string; unit: string; mine: number; avg: number; rank: number; of: number; lowerIsBetter: boolean }
const DEFS: { key: MetricKey; label: string; unit: string; lowerIsBetter: boolean }[] = [
  { key: 'days', label: 'Beosztott nap', unit: 'nap', lowerIsBetter: false },
  { key: 'xlAvg', label: 'XL sikeres cím naponta', unit: 'cím', lowerIsBetter: false },
  { key: 'lateDepPct', label: 'Késett indulások aránya', unit: '%', lowerIsBetter: true },
  { key: 'lateStopPct', label: 'Késett megállók aránya', unit: '%', lowerIsBetter: true },
  { key: 'perStop', label: 'Idő két megálló között', unit: 'perc', lowerIsBetter: true },
  { key: 'problems100', label: 'Nem behelyezett csomag 100 megállóra', unit: 'db', lowerIsBetter: true },
  { key: 'hours', label: 'Átlagos napi munkaidő', unit: 'óra', lowerIsBetter: false },
  { key: 'missed', label: 'Kimaradt nap', unit: 'nap', lowerIsBetter: true },
]

// Egy ember a csapathoz mérve: csak azok a mutatók, amelyekhez neki ÉS legalább még egy embernek van adata.
// A helyezésnél az 1. a legjobb; azonos érték azonos helyezést kap.
export function compareToTeam(all: Map<string, Metrics>, id: string): CompareRow[] {
  const mine = all.get(id)
  if (!mine) return []
  const rows: CompareRow[] = []
  for (const d of DEFS) {
    const v = mine[d.key]
    if (v == null) continue
    const vals = [...all.values()].map((m) => m[d.key]).filter((x): x is number => x != null)
    if (vals.length < 2) continue
    const better = vals.filter((x) => (d.lowerIsBetter ? x < v : x > v)).length
    rows.push({ ...d, mine: v, avg: vals.reduce((s, x) => s + x, 0) / vals.length, rank: better + 1, of: vals.length })
  }
  return rows
}
