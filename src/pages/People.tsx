import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'
import PersonProfileView, { type PersonData } from '../components/PersonProfileView'
import { DayTimeline, PersonRecords } from '../components/PersonExtras'
import { flagOf, unexcused, type AbsenceLike, type PersonSignals } from '../lib/peopleFlags'
import { minutesApart, plannedStartOf } from '../lib/personStats'
import { compareToTeam, perPersonMetrics, type TeamInputs } from '../lib/teamStats'
import { carIssueStatusLabel, memberLabel, roleLabel, statusLabel, todayISO } from '../lib/labels'
import { errMsg } from '../lib/errors'
import { readPayBasis, savePayBasis } from '../lib/payBasis'
import type { AdvanceBasis, XlResultLike } from '../lib/payroll'
import { advancesByMonth, attendance, buildMonthRows, carDays, dailyHours, departures, monthlyAvgHours, monthsOf, rateResolver, routeTempo, xlSeries, type PAdjustment, type PCheckin, type PEvent, type PShift, type PStopLog, type RateRow, type WsRate } from '../lib/personStats'
import type { Enums } from '../lib/database.types'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

type Preset = 'm3' | 'm6' | 'm12' | 'ytd' | 'all'
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'm3', label: '3 hónap' }, { key: 'm6', label: '6 hónap' }, { key: 'm12', label: '12 hónap' }, { key: 'ytd', label: 'Idén' }, { key: 'all', label: 'Minden' },
]
// Az időszak mindig teljes hónapokból áll, a folyó hónappal zárul
export function rangeOf(p: Preset, shiftBack = 0) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth()
  const len = p === 'ytd' ? m + 1 : p === 'all' ? 0 : { m3: 3, m6: 6, m12: 12 }[p]
  // shiftBack = 1: az ugyanilyen hosszú ELŐZŐ időszak (összehasonlításhoz)
  const start = p === 'all' ? new Date(2015, 0, 1) : new Date(y, m + 1 - len * (shiftBack + 1), 1)
  const end = new Date(y, m + 1 - len * shiftBack, 1)
  return { start: iso(start), endExclusive: iso(end), startISO: start.toISOString(), endISO: end.toISOString() }
}

const RATE_COLS = 'driver_day_rate, loader_day_rate, trainee_day_rate, box_day_rate, box_trainee_day_rate, box_round2_day_rate, xl_bonus_over, xl_bonus_amount'
const PROBLEM: [string, string][] = [
  ['nf', 'Nem fért be (NF)'], ['shortage', 'Hiány'], ['missorted', 'Félreválogatott'], ['oversize', 'Túlméretes'], ['returned', 'Visszahozott'],
  ['invalid_code', 'Érvénytelen kód'], ['do_not_place', 'Ne helyezd be'], ['cancelled', 'Törölt'], ['damaged', 'Sérült (régi jelölés)'], ['left_on_car', 'Autón maradt'],
]
// A járat átvételekor a szerver maga rögzít egy „Kiindultam” jelzést az átvevőnek (hogy azonnal folytathassa) —
// ez nem valódi indulás, a pontossági számításból kimarad
const realEvent = (e: { note?: string | null }) => !(e.note ?? '').startsWith('Átvett járat')
const plateOf = (x: unknown): string => (x as { plate?: string } | null)?.plate ?? '?'

// Minden, ami a szerverről kell egy ember adatlapjához (a számítás utána, helyben történik)
export async function loadPerson(id: string, r: ReturnType<typeof rangeOf>) {
  const or = `driver_id.eq.${id},loader_id.eq.${id},trainee_id.eq.${id}`
  const [prof, shifts, checkins, adj, fuel, inc, issues, clean, insp, sheets, logs, swaps, wsRates, hist, events, alarms, boxIssues, advAll, abs] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, phone, role, status, workspace_id, created_at, workspace:workspaces!profiles_workspace_id_fkey(name)').eq('id', id).maybeSingle(),
    fetchAll((f, t) => supabase.from('shifts').select('id, work_date, workspace_id, car_id, round, is_box, driver_id, loader_id, trainee_id, car:cars(plate, category:car_categories(box_sheet)), route:route_names(code, planned_start)')
      .or(or).gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('check_ins').select('id, user_id, work_date, workspace_id, first_checked_in_at, checked_in_at, checked_out_at, outside_geofence, out_outside_geofence, prev_car_id, manual_checkin, inspection_waived_at')
      .eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t)),
    supabase.from('adjustments').select('type, amount, work_date, paid_on, reason').eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive).order('work_date', { ascending: false }),
    supabase.from('fuel_logs').select('work_date, liters, amount, consumption, location, car:cars(plate)').eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive).order('work_date', { ascending: false }),
    supabase.from('incidents').select('work_date, note, car:cars(plate)').eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive).order('work_date', { ascending: false }),
    supabase.from('car_issues').select('created_at, note, status, car:cars(plate)').eq('user_id', id).gte('created_at', r.startISO).lt('created_at', r.endISO).order('created_at', { ascending: false }),
    supabase.from('cleanings').select('work_date, car:cars(plate)').eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive).order('work_date', { ascending: false }),
    supabase.from('car_inspections').select('id', { count: 'exact', head: true }).eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive),
    supabase.from('box_sheets').select('id, work_date, stops:box_sheet_stops(placed, missorted, nf, oversize, shortage, returned, damaged, left_on_car, invalid_code, do_not_place, cancelled, photos:box_sheet_stop_photos(count))')
      .eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive),
    fetchAll((f, t) => supabase.from('route_stop_logs').select('id, work_date, route_id, round, done_at, late_minutes, delay_reason').eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t)),
    supabase.from('swap_requests').select('id', { count: 'exact', head: true }).eq('requested_by', id).gte('created_at', r.startISO).lt('created_at', r.endISO),
    supabase.from('workspaces').select(`id, ${RATE_COLS}`),
    supabase.from('workspace_rate_history').select(`workspace_id, valid_from, ${RATE_COLS}`).order('valid_from'),
    fetchAll((f, t) => supabase.from('status_events').select('id, work_date, kind, at, note').eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t)),
    supabase.from('setoff_alarms').select('work_date, call_count').eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive),
    supabase.from('box_issue_reports').select('id', { count: 'exact', head: true }).eq('created_by', id).gte('created_at', r.startISO).lt('created_at', r.endISO),
    // az előlegek az időszaktól függetlenül, minden hónapra visszamenőleg
    supabase.from('adjustments').select('type, amount, work_date, paid_on, reason').eq('user_id', id).eq('type', 'advance').order('work_date', { ascending: false }),
    // az időszakot érintő távollétek (szabadság, betegség)
    supabase.from('absences').select('from_date, to_date').eq('user_id', id).lt('from_date', r.endExclusive).gte('to_date', r.start),
  ])
  for (const q of [prof, adj, fuel, inc, issues, clean, insp, sheets, swaps, wsRates, hist, alarms, boxIssues, advAll, abs]) if (q.error) throw q.error
  if (!prof.data) throw new Error('A munkatárs nem található, vagy nincs jogosultságod megnézni.')
  const wsIds = [...new Set(shifts.map((s) => s.workspace_id))]
  const xl = wsIds.length === 0 ? [] : await fetchAll((f, t) => supabase.from('xl_day_results').select('id, car_id, work_date, success_count')
    .in('workspace_id', wsIds).gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t))
  return {
    profile: prof.data, shifts, checkins, adjustments: adj.data ?? [], fuel: fuel.data ?? [], incidents: inc.data ?? [], issues: issues.data ?? [], cleanings: clean.data ?? [],
    inspections: insp.count ?? 0, sheets: sheets.data ?? [], logs, events: (events as (PEvent & { note: string | null })[]).filter(realEvent), alarms: alarms.data ?? [], boxIssues: boxIssues.count ?? 0, advancesAll: (advAll.data ?? []) as PAdjustment[], absences: (abs.data ?? []) as AbsenceLike[], swaps: swaps.count ?? 0, wsRates: (wsRates.data ?? []) as WsRate[], history: (hist.data ?? []) as RateRow[], xl: xl as XlResultLike[],
  }
}

// A csapat adatai ugyanarra az időszakra: ebből készül minden ember ugyanazon mutatója, az átlag és a helyezés
async function loadTeam(ws: string, r: ReturnType<typeof rangeOf>, today: string) {
  const [shifts, checkins, departed, logs, sheets, xl, abs] = await Promise.all([
    fetchAll((f, t) => supabase.from('shifts').select('id, work_date, workspace_id, car_id, round, is_box, driver_id, loader_id, trainee_id, car:cars(plate, category:car_categories(box_sheet)), route:route_names(code, planned_start)')
      .eq('workspace_id', ws).gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('check_ins').select('id, user_id, work_date, workspace_id, first_checked_in_at, checked_in_at, checked_out_at, outside_geofence, out_outside_geofence, prev_car_id')
      .eq('workspace_id', ws).gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('status_events').select('id, user_id, work_date, kind, at, note').eq('workspace_id', ws).eq('kind', 'departed').gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('route_stop_logs').select('id, user_id, work_date, route_id, round, done_at, late_minutes, delay_reason').eq('workspace_id', ws).gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('box_sheets').select('id, user_id, stops:box_sheet_stops(missorted, nf, oversize, shortage, returned, damaged, left_on_car, invalid_code, do_not_place, cancelled)')
      .eq('workspace_id', ws).gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('xl_day_results').select('id, car_id, work_date, success_count').eq('workspace_id', ws).gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t)),
    supabase.from('absences').select('user_id, from_date, to_date').eq('workspace_id', ws).lt('from_date', r.endExclusive).gte('to_date', r.start),
  ])
  if (abs.error) throw abs.error
  const inputs: TeamInputs = {
    shifts: shifts.map((s) => {
      const car = s.car as unknown as { plate: string; category: { box_sheet: boolean } | null } | null
      const route = s.route as unknown as { code: string; planned_start: string | null } | null
      return { work_date: s.work_date, workspace_id: s.workspace_id, car_id: s.car_id, round: s.round, is_box: s.is_box ?? !!car?.category?.box_sheet,
        driver_id: s.driver_id, loader_id: s.loader_id, trainee_id: s.trainee_id, plate: car?.plate ?? '?', route: route?.code ?? null, planned_start: route?.planned_start ?? null }
    }),
    checkins: checkins as PCheckin[], departed: (departed as (PEvent & { user_id: string; note: string | null })[]).filter(realEvent), logs: logs as (PStopLog & { user_id: string | null })[],
    sheetStops: sheets.map((sh) => {
      const st = (sh.stops ?? []) as unknown as Record<string, number | null>[]
      return { user_id: sh.user_id, stops: st.length, problems: st.reduce((a, x) => a + PROBLEM.reduce((b, [k]) => b + Number(x[k] ?? 0), 0), 0) }
    }),
    xl: xl as XlResultLike[], absences: (abs.data ?? []) as (AbsenceLike & { user_id: string })[],
  }
  return perPersonMetrics(inputs, today)
}

type Raw = Awaited<ReturnType<typeof loadPerson>>

// A betöltött adatokból az adatlap minden száma (tiszta számítás — az előző időszakra is ugyanez fut le)
function compute(raw: Raw, range: { start: string; endExclusive: string }, basis: AdvanceBasis, today: string, id: string, showPay: boolean, trimMonths: boolean): PersonData {
  const shifts: (PShift & { planned_start: string | null })[] = raw.shifts.map((s) => {
    const car = s.car as unknown as { plate: string; category: { box_sheet: boolean } | null } | null
    const route = s.route as unknown as { code: string; planned_start: string | null } | null
    return { work_date: s.work_date, workspace_id: s.workspace_id, car_id: s.car_id, round: s.round, is_box: s.is_box ?? !!car?.category?.box_sheet,
      driver_id: s.driver_id, loader_id: s.loader_id, trainee_id: s.trainee_id, plate: car?.plate ?? '?', route: route?.code ?? null, planned_start: route?.planned_start ?? null }
  })
  const checkins = raw.checkins as (PCheckin & { manual_checkin: boolean | null; inspection_waived_at: string | null })[]
  let months = monthsOf(range.start, range.endExclusive)
  if (trimMonths) {
    // „Minden”: az első olyan hónaptól, amelyikben van adat
    const first = [...shifts.map((x) => x.work_date), ...checkins.map((x) => x.work_date), ...raw.adjustments.map((x) => x.work_date)].sort()[0]?.slice(0, 7)
    months = first ? months.filter((ym) => ym >= first) : months.slice(-1)
  }
  const rateOf = rateResolver(raw.wsRates, raw.history)
  const p = raw.profile
  const ws = p.workspace_id ?? shifts[0]?.workspace_id ?? ''
  const nowRate = rateOf(ws, today.slice(0, 7))
  const stops = raw.sheets.flatMap((s) => (s.stops ?? []) as unknown as (Record<string, number | null> & { photos: { count: number }[] | null })[])
  const logs = raw.logs as PStopLog[]
  const tempo = routeTempo(logs)
  const rows = buildMonthRows({ userId: id, months, basis, today, checkins, shifts, xlResults: raw.xl, adjustments: raw.adjustments as PAdjustment[], rateOf })
  const xl = xlSeries(shifts, raw.xl, id, today)
  const problems = PROBLEM.map(([k, label]) => ({ label, value: stops.reduce((s, x) => s + Number(x[k] ?? 0), 0) })).sort((a, b) => b.value - a.value)
  const problemTotal = problems.reduce((s, x) => s + x.value, 0)
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)
  const xlAddr = sum(xl.map((x) => x.count)), xlPay = sum(rows.map((r) => r.xlPay + r.bonusPay)), boxPay = sum(rows.map((r) => r.boxPay))
  const cons = raw.fuel.map((f) => Number(f.consumption ?? 0)).filter((n) => n > 0)
  const advItems = raw.advancesAll.map((a) => ({ date: a.paid_on ?? a.work_date, amount: Number(a.amount), reason: a.reason }))
  return {
    person: { id: p.id, name: p.full_name || p.email || '—', email: p.email, phone: p.phone, role: p.role as Enums<'user_role'>, status: p.status as Enums<'user_status'>,
      workspace: (p.workspace as unknown as { name: string } | null)?.name ?? null, createdAt: p.created_at },
    showPay, basis, months: rows,
    hours: monthlyAvgHours(months, dailyHours(checkins)),
    cars: carDays(shifts, today), xl,
    xlBonus: nowRate ? { over: nowRate.xlBonusOver ?? 0, amount: nowRate.xlBonus ?? 0 } : null,
    attendance: (() => { const a = attendance(shifts, checkins, today); const missed = unexcused(a.missed, raw.absences); return { ...a, missed, excused: a.missed.length - missed.length } })(),
    counts: {
      outside: checkins.filter((c) => c.outside_geofence || c.out_outside_geofence).length,
      switches: checkins.filter((c) => !!c.prev_car_id).length,
      swaps: raw.swaps, inspections: raw.inspections, lateStops: tempo.lateStops, avgLate: tempo.avgLate,
    },
    adjustments: raw.adjustments.map((a) => ({ date: a.type === 'advance' ? a.paid_on ?? a.work_date : a.work_date, type: a.type, amount: Number(a.amount), reason: a.reason })),
    rateChanges: raw.history.filter((h) => h.workspace_id === ws).map((h) => ({ from: h.valid_from, driver: Number(h.driver_day_rate ?? 0), loader: Number(h.loader_day_rate ?? 0),
      box: Number(h.box_day_rate ?? 0), box2: Number(h.box_round2_day_rate ?? 0), bonusOver: Number(h.xl_bonus_over ?? 0), bonus: Number(h.xl_bonus_amount ?? 0) })).reverse(),
    fuel: raw.fuel.map((f) => ({ date: f.work_date, plate: plateOf(f.car), liters: f.liters == null ? null : Number(f.liters), amount: f.amount == null ? null : Number(f.amount), consumption: f.consumption == null ? null : Number(f.consumption), location: f.location })),
    incidents: raw.incidents.map((x) => ({ date: x.work_date, plate: plateOf(x.car), note: x.note })),
    issues: raw.issues.map((x) => ({ date: x.created_at, plate: plateOf(x.car), note: x.note, status: carIssueStatusLabel[x.status as Enums<'car_issue_status'>] ?? String(x.status) })),
    cleanings: raw.cleanings.map((c) => ({ date: c.work_date, plate: plateOf(c.car) })),
    box: { sheets: raw.sheets.length, stops: stops.length, placed: stops.reduce((s, x) => s + Number(x.placed ?? 0), 0), problems },
    advancesAll: { months: advancesByMonth(raw.advancesAll, today.slice(0, 7)), items: advItems, total: sum(advItems.map((a) => a.amount)) },
    punctuality: { departures: departures(shifts, raw.events, id), alarms: raw.alarms.length, calls: sum(raw.alarms.map((a) => Number(a.call_count ?? 0))) },
    tempo,
    quality: { stops: stops.length, problemTotal, per100: stops.length ? (problemTotal / stops.length) * 100 : null, noPhotoStops: stops.filter((x) => (x.photos?.[0]?.count ?? 0) === 0).length, boxIssues: raw.boxIssues },
    discipline: {
      manual: checkins.filter((c) => c.manual_checkin).length, waived: checkins.filter((c) => !!c.inspection_waived_at).length,
      notParked: new Set(checkins.filter((c) => !c.checked_out_at && c.work_date < today).map((c) => c.work_date)).size,
      cleanings: raw.cleanings.length, workedDays: new Set(checkins.map((c) => c.work_date)).size,
    },
    efficiency: {
      perXlAddress: xlAddr > 0 && xlPay > 0 ? xlPay / xlAddr : null, perBoxStop: tempo.stops > 0 && boxPay > 0 ? boxPay / tempo.stops : null,
      fuelAvg: cons.length ? sum(cons) / cons.length : null, damage: sum(rows.map((r) => r.deductions)),
    },
    prev: null, team: null,
  }
}

function PersonProfile({ id }: { id: string }) {
  const { profile: me } = useAuth()
  const isAdmin = me?.role === 'admin'
  const [preset, setPreset] = useState<Preset>('m6')
  const [basis, setBasis] = useState<AdvanceBasis>(() => readPayBasis())
  const range = useMemo(() => rangeOf(preset), [preset])
  const today = todayISO()
  const { data: raw, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['person', id, range.start, range.endExclusive],
    queryFn: () => loadPerson(id, range),
    placeholderData: (prev) => prev, // időszak-váltáskor az előző kép marad, nem ugrik a lap
  })

  // az ugyanilyen hosszú előző időszak, összehasonlításhoz („Minden” nézetben nincs mihez mérni)
  const prevRange = useMemo(() => (preset === 'all' ? null : rangeOf(preset, 1)), [preset])
  const { data: prevRaw } = useQuery({
    queryKey: ['person', id, prevRange?.start, prevRange?.endExclusive],
    enabled: !!prevRange,
    queryFn: () => loadPerson(id, prevRange!),
  })

  // a csapat ugyanarra az időszakra — embert váltva nem töltődik újra
  const teamWs = raw?.profile.workspace_id ?? null
  const { data: team } = useQuery({
    queryKey: ['person', 'team', teamWs, range.start, range.endExclusive],
    enabled: !!teamWs,
    staleTime: 5 * 60_000,
    queryFn: () => loadTeam(teamWs!, range, today),
  })

  const data = useMemo<PersonData | null>(() => {
    if (!raw) return null
    const cur = compute(raw, range, basis, today, id, isAdmin, preset === 'all')
    cur.team = team ? compareToTeam(team, id) : null
    if (prevRaw && prevRange) {
      const pv = compute(prevRaw, prevRange, basis, today, id, isAdmin, false)
      const lateDep = (d: PersonData) => d.punctuality.departures.filter((x) => x.lateMin > 5).length
      cur.prev = {
        days: pv.months.reduce((s, r) => s + r.days, 0), base: pv.months.reduce((s, r) => s + r.base, 0),
        missed: pv.attendance.worked === 0 ? null : pv.attendance.missed.length, lateDepartures: lateDep(pv), lateStops: pv.tempo.lateStops,
      }
    }
    return cur
  }, [raw, prevRaw, prevRange, team, range, basis, today, id, isAdmin, preset])

  return (
    <div className="stack">
      <h2>Adatlap</h2>
      <Link to="/emberek" className="btn ghost sm auto" style={{ textDecoration: 'none', alignSelf: 'flex-start' }}><Icon name="arrow-left" />Vissza a listához</Link>
      {/* Az időszak és a napok alapja az egész lapra érvényes */}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {PRESETS.map((x) => (
          <button key={x.key} type="button" className={`badge ${preset === x.key ? 'primary' : ''}`} aria-pressed={preset === x.key}
            style={{ cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, minHeight: 32 }} onClick={() => setPreset(x.key)}>{x.label}</button>
        ))}
        <span style={{ flex: 1 }} />
        {([['checkin', 'Becsekkolás szerint'], ['schedule', 'Beosztás szerint']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`badge ${basis === k ? 'primary' : ''}`} aria-pressed={basis === k}
            style={{ cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, minHeight: 32 }} onClick={() => { setBasis(k); savePayBasis(k) }}>{label}</button>
        ))}
      </div>
      {isLoading && <><Skeleton rows={2} /><Skeleton rows={4} /></>}
      {isError && <div className="alert error">Az adatlap betöltése nem sikerült: {errMsg(error, 'ismeretlen hiba')}</div>}
      {/* Aki nem csekkol be (pl. még nem regisztrált), annál a becsekkolás szerinti nézet üres — szóljunk, hol látszanak a napjai */}
      {data && basis === 'checkin' && data.attendance.worked === 0 && data.attendance.assigned > 0 && (
        <div className="alert info row" style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span>Az időszakban nincs becsekkolása, de {data.attendance.assigned} napra be volt osztva.</span>
          <button type="button" className="btn sm auto" onClick={() => { setBasis('schedule'); savePayBasis('schedule') }}>Mutasd a beosztás szerint</button>
        </div>
      )}
      {data && <div style={{ opacity: isFetching && !isLoading ? 0.6 : 1, transition: 'opacity .15s' }}><PersonProfileView data={data} /></div>}
      {raw && <DayTimeline userId={id} dates={[...new Set([...raw.shifts.map((x) => x.work_date).filter((d) => d <= today), ...raw.checkins.map((x) => x.work_date)])].sort().reverse()} />}
      {raw && <PersonRecords userId={id} workspaceId={raw.profile.workspace_id} />}
    </div>
  )
}

const LATE_MIN = 5
type Sort = 'flag' | 'name' | 'days'

function PeopleList() {
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('flag')
  const today = todayISO()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['people-list', currentWorkspaceId, today],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const ws = currentWorkspaceId!
      // a jelek az utolsó 30 nap alapján készülnek (a mai nap még nem „kimaradt”)
      const d0 = new Date(); d0.setDate(d0.getDate() - 30)
      const from = iso(d0)
      const [people, shifts, checkins, events, logs, alarms, abs, notes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email, role, status').eq('workspace_id', ws).neq('status', 'pending').order('full_name'),
        fetchAll((f, t) => supabase.from('shifts').select('id, driver_id, loader_id, trainee_id, work_date, round, is_box, car:cars(category:car_categories(box_sheet)), route:route_names(planned_start)')
          .eq('workspace_id', ws).gte('work_date', from).lte('work_date', today).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('check_ins').select('id, user_id, work_date, checked_out_at, inspection_waived_at').eq('workspace_id', ws).gte('work_date', from).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('status_events').select('id, user_id, work_date, at, note').eq('workspace_id', ws).eq('kind', 'departed').gte('work_date', from).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('route_stop_logs').select('id, user_id, late_minutes').eq('workspace_id', ws).gte('work_date', from).order('id').range(f, t)),
        supabase.from('setoff_alarms').select('user_id').eq('workspace_id', ws).gte('work_date', from),
        supabase.from('absences').select('user_id, from_date, to_date').eq('workspace_id', ws).gte('to_date', from),
        supabase.from('person_notes').select('user_id, kind').eq('workspace_id', ws).in('kind', ['warning', 'complaint']).gte('note_date', from),
      ])
      for (const r of [people, alarms, abs, notes]) if (r.error) throw r.error
      const sig = new Map<string, PersonSignals & { assigned: Set<string>; worked: Set<string>; box: { date: string; round: number; planned: string }[] }>()
      const of = (u: string) => { if (!sig.has(u)) sig.set(u, { missed: 0, lateDepartures: 0, stops: 0, lateStops: 0, alarms: 0, notParked: 0, waived: 0, warnings: 0, complaints: 0, assigned: new Set(), worked: new Set(), box: [] }); return sig.get(u)! }
      for (const s of shifts) {
        const isBox = s.is_box ?? !!(s.car as unknown as { category: { box_sheet: boolean } | null } | null)?.category?.box_sheet
        for (const u of [s.driver_id, s.loader_id, s.trainee_id]) {
          if (!u) continue
          of(u).assigned.add(s.work_date)
          if (isBox && u !== s.trainee_id) of(u).box.push({ date: s.work_date, round: s.round ?? 1, planned: plannedStartOf(s.round ?? 1, (s.route as unknown as { planned_start: string | null } | null)?.planned_start ?? null) })
        }
      }
      const open = new Map<string, Set<string>>(), waived = new Map<string, Set<string>>()
      for (const c of checkins) {
        of(c.user_id).worked.add(c.work_date)
        if (!c.checked_out_at && c.work_date < today) { if (!open.has(c.user_id)) open.set(c.user_id, new Set()); open.get(c.user_id)!.add(c.work_date) }
        if (c.inspection_waived_at) { if (!waived.has(c.user_id)) waived.set(c.user_id, new Set()); waived.get(c.user_id)!.add(c.work_date) }
      }
      // késett indulás: a nap „Kiindultam” jelzései idő szerint a Box-körökhöz párosítva
      const depBy = new Map<string, string[]>()
      for (const e of events.filter(realEvent)) { const k = `${e.user_id}|${e.work_date}`; depBy.set(k, [...(depBy.get(k) ?? []), e.at]) }
      for (const [k, ats] of depBy) {
        const [u, date] = k.split('|')
        const rounds = of(u).box.filter((b) => b.date === date).sort((x, y) => x.round - y.round)
        ats.sort().forEach((at, i) => {
          const r = rounds[i]; if (!r) return
          const dt = new Date(at)
          if (minutesApart(r.planned, `${pad(dt.getHours())}:${pad(dt.getMinutes())}`) > LATE_MIN) of(u).lateDepartures++
        })
      }
      for (const l of logs) { if (!l.user_id) continue; const x = of(l.user_id); x.stops++; if (Number(l.late_minutes ?? 0) > 0) x.lateStops++ }
      for (const a of alarms.data ?? []) of(a.user_id).alarms++
      for (const n of notes.data ?? []) { if (n.kind === 'warning') of(n.user_id).warnings++; else of(n.user_id).complaints++ }
      const absBy = new Map<string, AbsenceLike[]>()
      for (const a of abs.data ?? []) absBy.set(a.user_id, [...(absBy.get(a.user_id) ?? []), a])
      const ym = today.slice(0, 7)
      return (people.data ?? []).map((p) => {
        const x = sig.get(p.id)
        if (x) {
          // kimaradt nap csak annál értelmezhető, aki egyáltalán becsekkol (a még nem regisztrált nem tud)
          x.missed = x.worked.size === 0 ? 0 : unexcused([...x.assigned].filter((d) => d < today && !x.worked.has(d)), absBy.get(p.id) ?? []).length
          x.notParked = open.get(p.id)?.size ?? 0
          x.waived = waived.get(p.id)?.size ?? 0
        }
        return { ...p, days: x ? [...x.assigned].filter((d) => d.startsWith(ym)).length : 0, flag: x ? flagOf(x) : flagOf({ missed: 0, lateDepartures: 0, stops: 0, lateStops: 0, alarms: 0, notParked: 0, waived: 0, warnings: 0, complaints: 0 }) }
      })
    },
  })
  const words = norm(q).split(/\s+/).filter(Boolean)
  const shown = (data ?? []).filter((p) => words.every((w) => norm(`${p.full_name ?? ''} ${p.email ?? ''}`).includes(w)))
    .sort((a, b) => (sort === 'flag' ? b.flag.score - a.flag.score : sort === 'days' ? b.days - a.days : 0) || (a.full_name ?? '').localeCompare(b.full_name ?? '', 'hu'))
  const flagged = (data ?? []).filter((p) => p.flag.level).length
  return (
    <div className="stack">
      <h2>Adatlapok</h2>
      <div className="tiny muted">{currentWorkspace?.name ? `${currentWorkspace.name} · ` : ''}Koppints egy névre: fizetések, napok, pontosság, járat-tempó, események és jegyzetek egy helyen, diagramokkal. A jelek az utolsó 30 nap alapján készülnek.</div>
      <div className="input-icon">
        <Icon name="search" />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Keresés névre" autoComplete="off" />
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {([['flag', `Figyelmet kér elöl${flagged ? ` · ${flagged}` : ''}`], ['name', 'Név szerint'], ['days', 'Legtöbb nap elöl']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`badge ${sort === k ? 'primary' : ''}`} aria-pressed={sort === k}
            style={{ cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, minHeight: 32 }} onClick={() => setSort(k)}>{label}</button>
        ))}
      </div>
      {isLoading && <Skeleton rows={5} />}
      {isError && <div className="alert error">A lista betöltése nem sikerült: {errMsg(error, 'ismeretlen hiba')}</div>}
      {data && shown.length === 0 && <div className="empty"><span className="ico"><Icon name="users" size={40} /></span>{words.length ? 'Nincs ilyen nevű munkatárs.' : 'Nincs munkatárs ezen a munkaterületen.'}</div>}
      {shown.length > 0 && (
        <div className="card" style={{ padding: 6 }}>
          {shown.map((p, i) => (
            <Link key={p.id} to={`/emberek/${p.id}`} className="between" style={{ gap: 10, padding: '10px 10px', textDecoration: 'none', color: 'inherit', borderTop: i ? '1px solid var(--border)' : 'none', opacity: p.status === 'disabled' ? 0.6 : 1 }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{memberLabel(p)}</span>
                <span className="tiny muted" style={{ display: 'block' }}>{p.days > 0 ? `${p.days} beosztott nap ebben a hónapban` : 'ebben a hónapban nincs beosztva'}</span>
                {/* a jel ikon + szöveg, nem csak szín */}
                {p.flag.level && (
                  <span className="tiny row" style={{ gap: 5, marginTop: 2, alignItems: 'flex-start', color: p.flag.level === 'red' ? 'var(--danger)' : 'var(--warning)' }}>
                    <Icon name={p.flag.level === 'red' ? 'alert-triangle' : 'alert-circle'} size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ overflowWrap: 'anywhere' }}>{p.flag.reasons.join(' · ')}</span>
                  </span>
                )}
              </span>
              <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                {p.status !== 'active' && <span className={`badge ${p.status === 'invited' ? 'warning' : 'danger'}`}>{p.status === 'invited' ? 'még nem regisztrált' : statusLabel[p.status as Enums<'user_status'>]}</span>}
                {p.role !== 'crew' && p.status === 'active' && <span className="badge primary">{roleLabel[p.role as Enums<'user_role'>]}</span>}
                <Icon name="chevron-right" size={18} className="muted" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// Adatlapok: a munkatársak listája, névre koppintva egy ember minden adata
export default function People() {
  const { id } = useParams()
  return id ? <PersonProfile key={id} id={id} /> : <PeopleList />
}
