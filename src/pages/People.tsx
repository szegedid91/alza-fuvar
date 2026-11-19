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
import { carIssueStatusLabel, memberLabel, roleLabel, statusLabel, todayISO } from '../lib/labels'
import { errMsg } from '../lib/errors'
import { readPayBasis, savePayBasis } from '../lib/payBasis'
import type { AdvanceBasis, XlResultLike } from '../lib/payroll'
import { attendance, buildMonthRows, carDays, dailyHours, monthlyAvgHours, monthsOf, rateResolver, xlSeries, type PAdjustment, type PCheckin, type PShift, type RateRow, type WsRate } from '../lib/personStats'
import type { Enums } from '../lib/database.types'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

type Preset = 'm3' | 'm6' | 'm12' | 'ytd'
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'm3', label: '3 hónap' }, { key: 'm6', label: '6 hónap' }, { key: 'm12', label: '12 hónap' }, { key: 'ytd', label: 'Idén' },
]
// Az időszak mindig teljes hónapokból áll, a folyó hónappal zárul
export function rangeOf(p: Preset) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth()
  const start = p === 'ytd' ? new Date(y, 0, 1) : new Date(y, m - ({ m3: 2, m6: 5, m12: 11 }[p]), 1)
  const end = new Date(y, m + 1, 1)
  return { start: iso(start), endExclusive: iso(end), startISO: start.toISOString(), endISO: end.toISOString() }
}

const RATE_COLS = 'driver_day_rate, loader_day_rate, trainee_day_rate, box_day_rate, box_trainee_day_rate, box_round2_day_rate, xl_bonus_over, xl_bonus_amount'
const PROBLEM: [string, string][] = [
  ['nf', 'Nem fért be (NF)'], ['shortage', 'Hiány'], ['missorted', 'Félreválogatott'], ['oversize', 'Túlméretes'], ['returned', 'Visszahozott'],
  ['invalid_code', 'Érvénytelen kód'], ['do_not_place', 'Ne helyezd be'], ['cancelled', 'Törölt'], ['damaged', 'Sérült (régi jelölés)'], ['left_on_car', 'Autón maradt'],
]
const plateOf = (x: unknown): string => (x as { plate?: string } | null)?.plate ?? '?'

// Minden, ami a szerverről kell egy ember adatlapjához (a számítás utána, helyben történik)
export async function loadPerson(id: string, r: ReturnType<typeof rangeOf>) {
  const or = `driver_id.eq.${id},loader_id.eq.${id},trainee_id.eq.${id}`
  const [prof, shifts, checkins, adj, fuel, inc, issues, clean, insp, sheets, logs, swaps, wsRates, hist] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, phone, role, status, workspace_id, created_at, workspace:workspaces!profiles_workspace_id_fkey(name)').eq('id', id).maybeSingle(),
    fetchAll((f, t) => supabase.from('shifts').select('id, work_date, workspace_id, car_id, round, is_box, driver_id, loader_id, trainee_id, car:cars(plate, category:car_categories(box_sheet)), route:route_names(code)')
      .or(or).gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('check_ins').select('id, user_id, work_date, workspace_id, first_checked_in_at, checked_in_at, checked_out_at, outside_geofence, out_outside_geofence, prev_car_id')
      .eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t)),
    supabase.from('adjustments').select('type, amount, work_date, paid_on, reason').eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive).order('work_date', { ascending: false }),
    supabase.from('fuel_logs').select('work_date, liters, amount, consumption, location, car:cars(plate)').eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive).order('work_date', { ascending: false }),
    supabase.from('incidents').select('work_date, note, car:cars(plate)').eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive).order('work_date', { ascending: false }),
    supabase.from('car_issues').select('created_at, note, status, car:cars(plate)').eq('user_id', id).gte('created_at', r.startISO).lt('created_at', r.endISO).order('created_at', { ascending: false }),
    supabase.from('cleanings').select('work_date, car:cars(plate)').eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive).order('work_date', { ascending: false }),
    supabase.from('car_inspections').select('id', { count: 'exact', head: true }).eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive),
    supabase.from('box_sheets').select('id, work_date, stops:box_sheet_stops(placed, missorted, nf, oversize, shortage, returned, damaged, left_on_car, invalid_code, do_not_place, cancelled)')
      .eq('user_id', id).gte('work_date', r.start).lt('work_date', r.endExclusive),
    fetchAll((f, t) => supabase.from('route_stop_logs').select('id, late_minutes').eq('user_id', id).gt('late_minutes', 0).gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t)),
    supabase.from('swap_requests').select('id', { count: 'exact', head: true }).eq('requested_by', id).gte('created_at', r.startISO).lt('created_at', r.endISO),
    supabase.from('workspaces').select(`id, ${RATE_COLS}`),
    supabase.from('workspace_rate_history').select(`workspace_id, valid_from, ${RATE_COLS}`).order('valid_from'),
  ])
  for (const q of [prof, adj, fuel, inc, issues, clean, insp, sheets, swaps, wsRates, hist]) if (q.error) throw q.error
  if (!prof.data) throw new Error('A munkatárs nem található, vagy nincs jogosultságod megnézni.')
  const wsIds = [...new Set(shifts.map((s) => s.workspace_id))]
  const xl = wsIds.length === 0 ? [] : await fetchAll((f, t) => supabase.from('xl_day_results').select('id, car_id, work_date, success_count')
    .in('workspace_id', wsIds).gte('work_date', r.start).lt('work_date', r.endExclusive).order('id').range(f, t))
  return {
    profile: prof.data, shifts, checkins, adjustments: adj.data ?? [], fuel: fuel.data ?? [], incidents: inc.data ?? [], issues: issues.data ?? [], cleanings: clean.data ?? [],
    inspections: insp.count ?? 0, sheets: sheets.data ?? [], lateLogs: logs, swaps: swaps.count ?? 0, wsRates: (wsRates.data ?? []) as WsRate[], history: (hist.data ?? []) as RateRow[], xl: xl as XlResultLike[],
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

  const data = useMemo<PersonData | null>(() => {
    if (!raw) return null
    const months = monthsOf(range.start, range.endExclusive)
    const shifts: PShift[] = raw.shifts.map((s) => {
      const car = s.car as unknown as { plate: string; category: { box_sheet: boolean } | null } | null
      return { work_date: s.work_date, workspace_id: s.workspace_id, car_id: s.car_id, round: s.round, is_box: s.is_box ?? !!car?.category?.box_sheet,
        driver_id: s.driver_id, loader_id: s.loader_id, trainee_id: s.trainee_id, plate: car?.plate ?? '?', route: (s.route as unknown as { code: string } | null)?.code ?? null }
    })
    const checkins = raw.checkins as PCheckin[]
    const rateOf = rateResolver(raw.wsRates, raw.history)
    const p = raw.profile
    const ws = p.workspace_id ?? shifts[0]?.workspace_id ?? ''
    const nowRate = rateOf(ws, today.slice(0, 7))
    const stops = raw.sheets.flatMap((s) => (s.stops ?? []) as unknown as Record<string, number | null>[])
    const lates = raw.lateLogs.map((l) => Number(l.late_minutes)).filter((n) => n > 0)
    return {
      person: { id: p.id, name: p.full_name || p.email || '—', email: p.email, phone: p.phone, role: p.role as Enums<'user_role'>, status: p.status as Enums<'user_status'>,
        workspace: (p.workspace as unknown as { name: string } | null)?.name ?? null, createdAt: p.created_at },
      showPay: isAdmin, basis,
      months: buildMonthRows({ userId: id, months, basis, today, checkins, shifts, xlResults: raw.xl, adjustments: raw.adjustments as PAdjustment[], rateOf }),
      hours: monthlyAvgHours(months, dailyHours(checkins)),
      cars: carDays(shifts, today),
      xl: xlSeries(shifts, raw.xl, id, today),
      xlBonus: nowRate ? { over: nowRate.xlBonusOver ?? 0, amount: nowRate.xlBonus ?? 0 } : null,
      attendance: attendance(shifts, checkins, today),
      counts: {
        outside: checkins.filter((c) => c.outside_geofence || c.out_outside_geofence).length,
        switches: checkins.filter((c) => !!c.prev_car_id).length,
        swaps: raw.swaps, inspections: raw.inspections, lateStops: lates.length, avgLate: lates.length ? lates.reduce((s, x) => s + x, 0) / lates.length : null,
      },
      adjustments: raw.adjustments.map((a) => ({ date: a.type === 'advance' ? a.paid_on ?? a.work_date : a.work_date, type: a.type, amount: Number(a.amount), reason: a.reason })),
      rateChanges: raw.history.filter((h) => h.workspace_id === ws).map((h) => ({ from: h.valid_from, driver: Number(h.driver_day_rate ?? 0), loader: Number(h.loader_day_rate ?? 0),
        box: Number(h.box_day_rate ?? 0), box2: Number(h.box_round2_day_rate ?? 0), bonusOver: Number(h.xl_bonus_over ?? 0), bonus: Number(h.xl_bonus_amount ?? 0) })).reverse(),
      fuel: raw.fuel.map((f) => ({ date: f.work_date, plate: plateOf(f.car), liters: f.liters == null ? null : Number(f.liters), amount: f.amount == null ? null : Number(f.amount), consumption: f.consumption == null ? null : Number(f.consumption), location: f.location })),
      incidents: raw.incidents.map((x) => ({ date: x.work_date, plate: plateOf(x.car), note: x.note })),
      issues: raw.issues.map((x) => ({ date: x.created_at, plate: plateOf(x.car), note: x.note, status: carIssueStatusLabel[x.status as Enums<'car_issue_status'>] ?? String(x.status) })),
      cleanings: raw.cleanings.map((c) => ({ date: c.work_date, plate: plateOf(c.car) })),
      box: {
        sheets: raw.sheets.length, stops: stops.length, placed: stops.reduce((s, x) => s + Number(x.placed ?? 0), 0),
        problems: PROBLEM.map(([k, label]) => ({ label, value: stops.reduce((s, x) => s + Number(x[k] ?? 0), 0) })).sort((a, b) => b.value - a.value),
      },
    }
  }, [raw, range, basis, today, id, isAdmin])

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
    </div>
  )
}

function PeopleList() {
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const [q, setQ] = useState('')
  const ym = todayISO().slice(0, 7)
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['people-list', currentWorkspaceId, ym],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const [y, m] = ym.split('-').map(Number)
      const next = `${m === 12 ? y + 1 : y}-${pad(m === 12 ? 1 : m + 1)}-01`
      const [people, shifts] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email, role, status').eq('workspace_id', currentWorkspaceId!).neq('status', 'pending').order('full_name'),
        fetchAll((f, t) => supabase.from('shifts').select('id, driver_id, loader_id, trainee_id, work_date').eq('workspace_id', currentWorkspaceId!)
          .gte('work_date', `${ym}-01`).lt('work_date', next).order('id').range(f, t)),
      ])
      if (people.error) throw people.error
      const days = new Map<string, Set<string>>()
      for (const s of shifts) for (const u of [s.driver_id, s.loader_id, s.trainee_id]) { if (!u) continue; if (!days.has(u)) days.set(u, new Set()); days.get(u)!.add(s.work_date) }
      return (people.data ?? []).map((p) => ({ ...p, days: days.get(p.id)?.size ?? 0 }))
    },
  })
  const words = norm(q).split(/\s+/).filter(Boolean)
  const shown = (data ?? []).filter((p) => words.every((w) => norm(`${p.full_name ?? ''} ${p.email ?? ''}`).includes(w)))
  return (
    <div className="stack">
      <h2>Adatlapok</h2>
      <div className="tiny muted">{currentWorkspace?.name ? `${currentWorkspace.name} · ` : ''}Koppints egy névre: fizetések, ledolgozott napok, bérváltozások, tankolások, események, takarítások egy helyen, diagramokkal.</div>
      <div className="input-icon">
        <Icon name="search" />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Keresés névre" autoComplete="off" />
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
