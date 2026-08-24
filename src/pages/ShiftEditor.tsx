import { Fragment, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useMembers } from '../hooks/useMembers'
import { useCars } from '../hooks/useCars'
import { useCarCategories } from '../hooks/useCarCategories'
import PersonPicker from '../components/PersonPicker'
import ConfirmButton from '../components/ConfirmButton'
import CarTimeline, { type TimelineEntry } from '../components/CarTimeline'
import { resolveNames } from '../lib/names'
import { todayISO, formatDate, formatDateTime, carIssueStatusLabel } from '../lib/labels'
import type { Tables } from '../lib/database.types'

type Car = Tables<'cars'>
type Shift = Tables<'shifts'>

// ---- Naptár segédek (hétfő-kezdéssel) ----
function pad2(n: number): string { return String(n).padStart(2, '0') }

function monthGrid(ym: string): (string | null)[] {
  const [y, m] = ym.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7 // hétfő = 0
  const cells: (string | null)[] = Array.from({ length: firstDow }, () => null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${ym}-${pad2(d)}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

function addDays(dateISO: string, n: number): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
}

function mondayOf(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return addDays(dateISO, -((dt.getDay() + 6) % 7))
}

// Azonos sormagasság a fix és a görgethető táblázatban (2 kompakt mező + padding)
const ROW_H = 80
const ROW_H_SINGLE = 46 // 1 fős kategória: csak egy mező
const HEAD_H = 36

// Az autó kategóriája szerinti létszám (1 = csak sofőr, 2 = sofőr + rakodó); alap 2
function crewSizeFor(cars: Car[] | undefined, categories: { id: string; crew_size: number }[] | undefined, carId: string): 1 | 2 {
  const car = (cars ?? []).find((c) => c.id === carId)
  const cat = (categories ?? []).find((k) => k.id === car?.category_id)
  return cat?.crew_size === 1 ? 1 : 2
}

const DAY_NAMES_LONG = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap']

// Timestamp → helyi naptári nap (a .slice(0,10) az UTC-napot adná,
// így a hajnali események a szomszéd napon jelennének meg)
function localDateOf(ts: string): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const MONTH_NAMES = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december']

function monthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${y}. ${MONTH_NAMES[m - 1]}`
}

// Rövid név a naptár-chipekhez (a név utolsó tagja)
function shortName(full: string | null | undefined): string {
  if (!full) return '—'
  const parts = full.trim().split(/\s+/)
  return parts[parts.length - 1].slice(0, 7)
}

// A hónap összes naptár-adata egyben: beosztások + események + nevek
interface MonthData {
  shifts: Shift[]
  incidents: { work_date: string; car_id: string | null; user_id: string; note: string | null; created_at: string }[]
  cleanings: { work_date: string; car_id: string; user_id: string; created_at: string }[]
  geoCheckins: { work_date: string; car_id: string; user_id: string; outside_geofence: boolean; out_outside_geofence: boolean }[]
  issues: { created_at: string; car_id: string; user_id: string; note: string; status: 'open' | 'in_progress' | 'resolved' }[]
  switches: { work_date: string; user_id: string; car_id: string; prev_car_id: string | null; checked_in_at: string; switch_reason: string }[]
  names: Record<string, string>
}

// Függő műszakcsere-kérések — a menedzser dönt, akár aznap
function SwapApprovals({ workspaceId }: { workspaceId: string | null }) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const { data: pending } = useQuery({
    queryKey: ['swap-pending', workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('swap_requests')
        .select('*, shift:shifts(work_date, driver_id, loader_id, car:cars(plate))')
        .eq('workspace_id', workspaceId!)
        .eq('status', 'pending')
        .order('created_at')
      if (error) throw error
      const rows = data ?? []
      const shiftOf = (r: (typeof rows)[number]) =>
        r.shift as unknown as { work_date: string; driver_id: string | null; loader_id: string | null; car: { plate: string } | null } | null
      const names = await resolveNames(rows.flatMap((r) => [r.requested_by, r.partner_id, shiftOf(r)?.driver_id, shiftOf(r)?.loader_id]))
      return rows.map((r) => ({ ...r, _shift: shiftOf(r), _names: names }))
    },
  })

  async function decide(id: string, approve: boolean) {
    setError(null)
    const { error } = await supabase.rpc('decide_swap', { p_request_id: id, p_approve: approve })
    if (error) { setError(error.message); return }
    await qc.invalidateQueries({ queryKey: ['swap-pending'] })
    await qc.invalidateQueries({ queryKey: ['shift-cal'] })
    // A heti táblázat és a "ma" nézet is az érintett shiftet mutatja
    await qc.invalidateQueries({ queryKey: ['shift-week'] })
    await qc.invalidateQueries({ queryKey: ['today'] })
  }

  if ((pending?.length ?? 0) === 0) return null
  return (
    <div className="card stack" style={{ borderColor: 'var(--warning)' }}>
      <div className="card-title">🔄 Függő cserekérések ({pending!.length})</div>
      {error && <div className="alert error">{error}</div>}
      {pending!.map((r) => {
        const s = r._shift
        const names = r._names as Record<string, string>
        return (
          <div key={r.id} className="stack" style={{ gap: 6 }}>
            <div>
              <div className="small" style={{ fontWeight: 700 }}>
                {s ? `${formatDate(s.work_date)} · ${s.car?.plate ?? '?'}` : 'Ismeretlen beosztás'}
              </div>
              <div className="tiny muted">Kérte: {names[r.requested_by] ?? '?'} · {formatDateTime(r.created_at)}</div>
              {s && (
                <div className="tiny muted">
                  Sofőr: {s.driver_id ? names[s.driver_id] ?? '?' : '—'} ↔ Rakodó: {s.loader_id ? names[s.loader_id] ?? '?' : '—'}
                </div>
              )}
              {r.partner_id && (
                <span className={`badge ${r.partner_decision === 'approved' ? 'success' : r.partner_decision === 'rejected' ? 'danger' : 'warning'}`} style={{ marginTop: 4 }}>
                  Társ ({names[r.partner_id] ?? '?'}): {r.partner_decision === 'approved' ? '✔ elfogadta' : r.partner_decision === 'rejected' ? '✖ elutasította' : 'még nem döntött'}
                </span>
              )}
            </div>
            <div className="btn-grid">
              <button className="btn danger sm" onClick={() => void decide(r.id, false)}>Elutasítás</button>
              <button className="btn sm" onClick={() => void decide(r.id, true)}>Csere jóváhagyása</button>
            </div>
            {r.partner_decision !== 'approved' && (
              <p className="tiny muted" style={{ margin: 0 }}>A társ jóváhagyása nélkül is átteheted — a te döntésed a végső.</p>
            )}
            <div className="divider" />
          </div>
        )
      })}
    </div>
  )
}

// ---- Heti táblázat-nézet: oszlopok = napok, sorok = autók (rendszám),
// cellákban sofőr/rakodó választó — a megszokott Google Sheets-es munkamenet mintájára ----
function WeekTable() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const today = todayISO()

  const [weekStart, setWeekStart] = useState(() => mondayOf(todayISO()))
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const { data: members } = useMembers()
  // MINDEN autó kell (az inaktivált autó heti beosztása különben eltűnne a
  // táblából, miközben a bérszámításban benne maradna) — az aktívak külön
  const { data: cars } = useCars()
  const activeCars = useMemo(() => (cars ?? []).filter((c) => c.active), [cars])
  const { data: categories } = useCarCategories()
  const [addedCars, setAddedCars] = useState<string[]>([])
  const memberOptions = useMemo(() => (members ?? []).map((m) => ({ id: m.id, label: m.full_name || m.email || '—' })), [members])
  const [error, setError] = useState<string | null>(null)
  const [busyCell, setBusyCell] = useState<string | null>(null)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)
  // Sor-menü (autó cseréje / kivétele a hétből)
  const [rowMenu, setRowMenu] = useState<{ carId: string; top: number; left: number } | null>(null)
  const [rowBusy, setRowBusy] = useState(false)

  const { data: shifts } = useQuery({
    queryKey: ['shift-week', currentWorkspaceId, weekStart],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('shifts').select('*')
        .eq('workspace_id', currentWorkspaceId!)
        .gte('work_date', weekStart).lte('work_date', addDays(weekStart, 6))
      if (error) throw error
      return (data ?? []) as Shift[]
    },
  })

  // Napközbeni autócserék a héten: user+nap szerinti idővonalak, ahol volt váltás
  const { data: weekSwitches } = useQuery({
    queryKey: ['week-car-switches', currentWorkspaceId, weekStart],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data } = await supabase.from('check_ins')
        .select('user_id, work_date, checked_in_at, checked_out_at, switch_reason, car:cars!check_ins_car_id_fkey(plate)')
        .eq('workspace_id', currentWorkspaceId!)
        .gte('work_date', weekStart).lte('work_date', addDays(weekStart, 6))
        .order('checked_in_at')
      const rows = data ?? []
      // csoportosítás user+nap szerint; csak ahol tényleg volt autócsere
      const groups = new Map<string, { userId: string; date: string; entries: TimelineEntry[] }>()
      for (const r of rows) {
        const key = `${r.user_id}|${r.work_date}`
        const g = groups.get(key) ?? { userId: r.user_id, date: r.work_date, entries: [] }
        g.entries.push({
          plate: (r.car as unknown as { plate: string } | null)?.plate ?? '?',
          from: r.checked_in_at,
          to: r.checked_out_at,
          reason: r.switch_reason,
        })
        groups.set(key, g)
      }
      const withSwitch = [...groups.values()].filter((g) => g.entries.length > 1 || g.entries.some((e) => e.reason))
      const names = await resolveNames(withSwitch.map((g) => g.userId))
      return withSwitch
        .map((g) => ({ ...g, name: names[g.userId] ?? 'Munkatárs' }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'hu'))
    },
  })

  const shiftAt = (carId: string, date: string) =>
    (shifts ?? []).find((s) => s.car_id === carId && s.work_date === date)

  // Sorok: amelyik autónak van beosztása a héten + a kézzel hozzáadottak
  // Kategória szerint csoportosítva (kategória nélküliek a végén), azon belül rendszám szerint
  const rowCars = useMemo(() => {
    const ids = new Set<string>(addedCars)
    for (const s of shifts ?? []) ids.add(s.car_id)
    const order = new Map((categories ?? []).map((c, i) => [c.id, i]))
    const rank = (c: Car) => (c.category_id && order.has(c.category_id) ? order.get(c.category_id)! : 9999)
    return (cars ?? [])
      .filter((c) => ids.has(c.id))
      .sort((a, b) => rank(a) - rank(b) || a.plate.localeCompare(b.plate))
  }, [shifts, addedCars, cars, categories])
  const rowCarIds = useMemo(() => rowCars.map((c) => c.id), [rowCars])
  const categoryName = (id: string | null) => (categories ?? []).find((c) => c.id === id)?.name ?? null
  const crewOf = (carId: string) => crewSizeFor(cars, categories, carId)
  // 1 fős kategóriánál is magas a sor, ha a héten valamelyik napon rakodó is
  // van beírva (a cella olyankor két mezőt mutat — a két tábla sormagassága
  // különben szétcsúszna)
  const rowH = (carId: string) => (
    crewOf(carId) === 1 && !(shifts ?? []).some((sh) => sh.car_id === carId && sh.loader_id)
      ? ROW_H_SINGLE : ROW_H
  )
  // Hány egymást követő sor tartozik ugyanabba a kategóriába (rowSpan-hoz)
  const groupSpan = (idx: number) => {
    const cat = rowCars[idx].category_id ?? ''
    let n = 1
    while (idx + n < rowCars.length && (rowCars[idx + n].category_id ?? '') === cat) n++
    return n
  }
  const isGroupStart = (idx: number) => idx === 0 || (rowCars[idx - 1].category_id ?? '') !== (rowCars[idx].category_id ?? '')

  // Fejenkénti napszám ezen a héten (mint a táblázat K–L oszlopa)
  const weekCounts = useMemo(() => {
    const byUser = new Map<string, Set<string>>()
    for (const s of shifts ?? []) {
      for (const uid of [s.driver_id, s.loader_id]) {
        if (!uid) continue
        if (!byUser.has(uid)) byUser.set(uid, new Set())
        byUser.get(uid)!.add(s.work_date)
      }
    }
    // Minden nem-admin/nem-menedzser tag felsorolva (0 nappal is);
    // admin/menedzser csak akkor, ha ténylegesen be van osztva a héten
    return (members ?? [])
      .filter((m) => (m.role !== 'admin' && m.role !== 'manager') || (byUser.get(m.id)?.size ?? 0) > 0)
      .map((m) => ({
        id: m.id, name: m.full_name || m.email || '—', count: byUser.get(m.id)?.size ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [shifts, members])

  // Ütközés: ugyanaz az ember aznap több helyre beosztva
  const dupSet = useMemo(() => {
    const cnt = new Map<string, number>()
    for (const s of shifts ?? []) for (const uid of [s.driver_id, s.loader_id]) {
      if (uid) cnt.set(`${s.work_date}|${uid}`, (cnt.get(`${s.work_date}|${uid}`) ?? 0) + 1)
    }
    return new Set([...cnt.entries()].filter(([, n]) => n > 1).map(([k]) => k))
  }, [shifts])

  async function setCell(carId: string, date: string, field: 'driver_id' | 'loader_id', value: string) {
    if (!currentWorkspaceId || !profile) return
    setError(null)
    setBusyCell(`${carId}|${date}`)
    try {
      const cur = shiftAt(carId, date)
      const driver = field === 'driver_id' ? (value || null) : cur?.driver_id ?? null
      const loader = field === 'loader_id' ? (value || null) : cur?.loader_id ?? null
      if (!driver && !loader) {
        // Mindkét mező üres → a napi beosztás törlődik
        if (cur) {
          const { error } = await supabase.from('shifts').delete().eq('id', cur.id)
          if (error) throw error
        }
      } else {
        const { error } = await supabase.from('shifts').upsert({
          workspace_id: currentWorkspaceId, work_date: date, car_id: carId,
          driver_id: driver, loader_id: loader, created_by: profile.id,
        }, { onConflict: 'car_id,work_date' })
        if (error) throw error
      }
      await qc.invalidateQueries({ queryKey: ['shift-week'] })
      await qc.invalidateQueries({ queryKey: ['shift-cal'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mentési hiba')
    } finally {
      setBusyCell(null)
    }
  }

  async function copyPrevWeek() {
    if (!currentWorkspaceId || !profile) return
    setCopyMsg(null); setError(null)
    const prevStart = addDays(weekStart, -7)
    const { data: prev, error: pErr } = await supabase.from('shifts').select('*')
      .eq('workspace_id', currentWorkspaceId).gte('work_date', prevStart).lt('work_date', weekStart)
    if (pErr) { setError(pErr.message); return }
    if ((prev ?? []).length === 0) { setCopyMsg('Az előző héten nincs beosztás.'); return }
    const rows = prev!.map((s) => ({
      workspace_id: currentWorkspaceId, work_date: addDays(s.work_date, 7), car_id: s.car_id,
      driver_id: s.driver_id, loader_id: s.loader_id, created_by: profile.id,
    }))
    const { error } = await supabase.from('shifts').upsert(rows, { onConflict: 'car_id,work_date' })
    if (error) { setError(error.message); return }
    setCopyMsg(`${rows.length} beosztás átmásolva az előző hétről.`)
    await qc.invalidateQueries({ queryKey: ['shift-week'] })
    await qc.invalidateQueries({ queryKey: ['shift-cal'] })
  }

  const carOf = (id: string) => (cars ?? []).find((c) => c.id === id)
  const selStyle = { minHeight: 32, padding: '4px 6px', fontSize: 12, borderRadius: 8 } as const

  const weekShiftsOf = (carId: string) => (shifts ?? []).filter((x) => x.car_id === carId)

  // Autó cseréje: a heti beosztások átkerülnek a másik autóra (csak olyanra, amelynek nincs beosztása a héten)
  async function swapCar(fromId: string, toId: string) {
    if (!currentWorkspaceId) return
    setError(null); setRowBusy(true)
    try {
      const { error } = await supabase.from('shifts').update({ car_id: toId })
        .eq('workspace_id', currentWorkspaceId).eq('car_id', fromId)
        .gte('work_date', weekStart).lte('work_date', addDays(weekStart, 6))
      if (error) throw error
      setAddedCars((p) => [...p.filter((id) => id !== fromId), toId])
      setRowMenu(null)
      await qc.invalidateQueries({ queryKey: ['shift-week'] })
      await qc.invalidateQueries({ queryKey: ['shift-cal'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Az autó cseréje nem sikerült')
    } finally { setRowBusy(false) }
  }

  // Autó kivétele a hétből: a heti beosztásai törlődnek, a sor eltűnik
  async function removeCarFromWeek(carId: string) {
    if (!currentWorkspaceId) return
    setError(null); setRowBusy(true)
    try {
      const { error } = await supabase.from('shifts').delete()
        .eq('workspace_id', currentWorkspaceId).eq('car_id', carId)
        .gte('work_date', weekStart).lte('work_date', addDays(weekStart, 6))
      if (error) throw error
      setAddedCars((p) => p.filter((id) => id !== carId))
      setRowMenu(null)
      await qc.invalidateQueries({ queryKey: ['shift-week'] })
      await qc.invalidateQueries({ queryKey: ['shift-cal'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Az autó kivétele nem sikerült')
    } finally { setRowBusy(false) }
  }

  return (
    <>
      <div className="card stack">
        <div className="between">
          <button className="btn ghost sm auto" onClick={() => setWeekStart(addDays(weekStart, -7))}>←</button>
          <div className="card-title" style={{ margin: 0 }}>{formatDate(weekStart)} – {formatDate(days[6])}</div>
          <button className="btn ghost sm auto" onClick={() => setWeekStart(addDays(weekStart, 7))}>→</button>
        </div>
        <div className="btn-grid">
          <button className="btn secondary sm" onClick={() => setWeekStart(mondayOf(todayISO()))}>📆 Ez a hét</button>
          <ConfirmButton className="btn secondary sm" confirmLabel="Másolás (felülír)" onConfirm={() => void copyPrevWeek()}>📋 Előző hét másolása</ConfirmButton>
        </div>
        {error && <div className="alert error">{error}</div>}
        {copyMsg && <div className="alert info">{copyMsg}</div>}

        {/* Bal blokk (kategória + rendszám) FIXEN áll, csak a nap-oszlopok görgethetők.
            A két táblázat sorai azonos, rögzített magasságúak → mindig egy vonalban maradnak. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: '3px 10px', flexShrink: 0 }}>
            <thead>
              <tr style={{ height: HEAD_H }}>
                <th className="wk-head wk-catcol">Kategória</th>
                <th className="wk-head" style={{ textAlign: 'left', minWidth: 84, paddingLeft: 10 }}>Autó</th>
              </tr>
            </thead>
            <tbody>
              {rowCarIds.map((carId, rowIdx) => (
                <Fragment key={carId}>
                  {rowIdx > 0 && isGroupStart(rowIdx) && (
                    <tr style={{ height: 8 }}>
                      <td colSpan={2} style={{ padding: 0 }}><div style={{ height: 2, background: 'var(--border)', borderRadius: 1 }} /></td>
                    </tr>
                  )}
                <tr style={{ height: rowH(carId) }}>
                  {isGroupStart(rowIdx) && (
                    <td className="wk-catcol" rowSpan={groupSpan(rowIdx)} title={categoryName(rowCars[rowIdx].category_id) ?? 'Nincs kategória'}>
                      {categoryName(rowCars[rowIdx].category_id) ?? '—'}
                    </td>
                  )}
                  <td className="wk-plate" style={{ background: rowIdx % 2 ? 'var(--bg-elev-2)' : 'var(--bg)', padding: 0 }}>
                    <button
                      type="button"
                      title="Autó cseréje / kivétele a hétből"
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setRowMenu(rowMenu?.carId === carId ? null : { carId, top: r.bottom + 4, left: r.left })
                      }}
                      style={{
                        width: '100%', height: '100%', minHeight: 40, border: 'none', background: 'transparent', color: 'inherit',
                        font: 'inherit', fontWeight: 800, cursor: 'pointer', padding: '0 6px 0 10px',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
                      }}
                    >
                      <span>{carOf(carId)?.plate ?? '?'}</span>
                      <span className="muted" style={{ fontSize: 14, lineHeight: 1 }}>⋯</span>
                    </button>
                  </td>
                </tr>
                </Fragment>
              ))}
            </tbody>
          </table>

          <div style={{ overflowX: 'auto', flex: 1, minWidth: 0 }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: '3px 10px', minWidth: 7 * 146, width: '100%' }}>
              <thead>
                <tr style={{ height: HEAD_H }}>
                  {days.map((d, i) => (
                    <th key={d} style={{ minWidth: 140, fontSize: 11, padding: '3px 4px', borderRadius: 6, background: d === today ? 'rgba(20,184,166,.14)' : undefined }}>
                      <div>{DAY_NAMES_LONG[i]}</div>
                      <div className="muted">{d.slice(5).replace('-', '.')}.</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowCarIds.map((carId, rowIdx) => (
                  <Fragment key={carId}>
                    {rowIdx > 0 && isGroupStart(rowIdx) && (
                      <tr style={{ height: 8 }}>
                        <td colSpan={7} style={{ padding: 0 }}><div style={{ height: 2, background: 'var(--border)', borderRadius: 1 }} /></td>
                      </tr>
                    )}
                  <tr style={{ height: rowH(carId) }}>
                    {days.map((d) => {
                      const s = shiftAt(carId, d)
                      const busy = busyCell === `${carId}|${d}`
                      const rowBg = rowIdx % 2 ? 'var(--bg-elev-2)' : 'var(--bg)'
                      // 1 fős kategória: csak sofőr-mező (a rakodó akkor is látszik, ha korábbról be van töltve, hogy törölhető legyen)
                      const fields: ('driver_id' | 'loader_id')[] = crewOf(carId) === 2 || s?.loader_id ? ['driver_id', 'loader_id'] : ['driver_id']
                      return (
                        <td key={d} style={{ verticalAlign: 'top', background: d === today ? 'rgba(20,184,166,.10)' : rowBg, borderRadius: 8, padding: 4, opacity: busy ? 0.55 : 1 }}>
                          {fields.map((field) => {
                            const val = (field === 'driver_id' ? s?.driver_id : s?.loader_id) ?? ''
                            const dup = !!val && dupSet.has(`${d}|${val}`)
                            return (
                              <div key={field} style={{ marginBottom: field === 'driver_id' && fields.length === 2 ? 3 : 0 }}>
                                <PersonPicker
                                  compact
                                  value={val}
                                  options={memberOptions}
                                  placeholder={field === 'driver_id' ? (crewOf(carId) === 1 ? '— munkatárs —' : '— sofőr —') : '— rakodó —'}
                                  disabled={busy}
                                  danger={dup}
                                  title={dup ? 'Ütközés: aznap máshova is be van osztva!' : field === 'driver_id' ? (crewOf(carId) === 1 ? 'Munkatárs' : 'Sofőr') : 'Rakodó'}
                                  onChange={(id) => void setCell(carId, d, field, id)}
                                />
                              </div>
                            )
                          })}
                        </td>
                      )
                    })}
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {rowMenu && (() => {
          const car = carOf(rowMenu.carId)
          const n = weekShiftsOf(rowMenu.carId).length
          const freeCars = activeCars.filter((c) => c.id !== rowMenu.carId && !rowCarIds.includes(c.id))
          return (
            <>
              <div onClick={() => setRowMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 290 }} />
              <div
                className="card stack"
                style={{ position: 'fixed', top: rowMenu.top, left: Math.max(8, Math.min(rowMenu.left, window.innerWidth - 300)), width: 290, zIndex: 300, gap: 8, padding: 12 }}
              >
                <div className="between">
                  <div style={{ fontWeight: 800 }}>🚚 {car?.plate}</div>
                  <span className="tiny muted">{n} beosztás a héten</span>
                </div>
                <div className="field">
                  <label>🔁 Csere másik autóra (a heti beosztás átkerül)</label>
                  <select className="select" style={selStyle} value="" disabled={rowBusy || freeCars.length === 0}
                    onChange={(e) => { if (e.target.value) void swapCar(rowMenu.carId, e.target.value) }}>
                    <option value="">{freeCars.length === 0 ? 'Nincs szabad autó ezen a héten' : '— válassz autót —'}</option>
                    {freeCars.map((c) => (
                      <option key={c.id} value={c.id}>{c.plate}{categoryName(c.category_id) ? ` · ${categoryName(c.category_id)}` : ''}</option>
                    ))}
                  </select>
                </div>
                <ConfirmButton className="btn danger sm" confirmLabel={n > 0 ? `Igen, ${n} beosztás törlése` : 'Igen, kiveszem'} disabled={rowBusy}
                  onConfirm={() => void removeCarFromWeek(rowMenu.carId)}>
                  ➖ Kivétel a hétből{n > 0 ? ` (${n} beosztás törlődik)` : ''}
                </ConfirmButton>
                <button className="btn ghost sm" onClick={() => setRowMenu(null)}>Mégse</button>
              </div>
            </>
          )
        })()}

        <select
          className="select"
          style={{ ...selStyle, maxWidth: 320 }}
          value=""
          onChange={(e) => { if (e.target.value) setAddedCars((p) => [...p, e.target.value]) }}
        >
          <option value="">＋ Autó (rendszám) hozzáadása a heti táblázathoz…</option>
          {activeCars.filter((c) => !rowCarIds.includes(c.id)).map((c) => (
            <option key={c.id} value={c.id}>{c.plate}{categoryName(c.category_id) ? ` · ${categoryName(c.category_id)}` : ''}{c.label ? ` · ${c.label}` : ''}</option>
          ))}
        </select>
        <div className="tiny muted">
          A cella azonnal mentődik. Piros keret = az ember aznap két helyre is be van osztva.
          Mező kiürítése törli a napi beosztást. A rendszámra koppintva az autó cserélhető vagy kivehető a hétből. Görgethető oldalra →
        </div>
      </div>

      {(weekSwitches?.length ?? 0) > 0 && (
        <div className="card stack">
          <div className="card-title">🔁 Napközbeni autócserék ezen a héten</div>
          {weekSwitches!.map((g) => (
            <div key={`${g.userId}|${g.date}`} className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <div className="small" style={{ fontWeight: 700 }}>{formatDate(g.date)} · {g.name}</div>
              <CarTimeline entries={g.entries} />
            </div>
          ))}
        </div>
      )}

      <div className="card stack">
        <div className="card-title">👥 Napok ezen a héten</div>
        {weekCounts.length === 0 && <div className="tiny muted">Nincs munkatárs ezen a munkaterületen.</div>}
        <div className="grid-2">
          {weekCounts.map((r) => (
            <div key={r.id} className="between">
              <span className="small" style={{ fontWeight: r.count > 0 ? 700 : 400, color: r.count === 0 ? 'var(--text-dim)' : undefined }}>{r.name}</span>
              <span className={`badge ${r.count > 0 ? 'primary' : ''}`}>{r.count}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export default function ShiftEditor() {
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const today = todayISO()

  // Nézet: heti táblázat (Sheets-szerű) vagy havi naptár — a választás megmarad
  const [view, setView] = useState<'table' | 'calendar'>(
    () => (localStorage.getItem('alza-shift-view') === 'calendar' ? 'calendar' : 'table'),
  )
  useEffect(() => { localStorage.setItem('alza-shift-view', view) }, [view])

  const [month, setMonth] = useState(today.slice(0, 7))
  const [selectedDate, setSelectedDate] = useState('') // '' = nincs nap kiválasztva
  const [carFilter, setCarFilter] = useState('') // '' = összes autó

  const { data: members } = useMembers()
  const { data: cars } = useCars(true)
  const { data: categories } = useCarCategories()
  const crewOf = (carId: string) => crewSizeFor(cars, categories, carId)

  // A hónap beosztásai + eseményei egy lekérdezés-körben
  const { data: cal } = useQuery<MonthData>({
    queryKey: ['shift-cal', currentWorkspaceId, month],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const ws = currentWorkspaceId!
      const start = `${month}-01`
      const end = shiftMonth(month, 1) + '-01'
      // A created_at (timestamptz) szűréséhez a HELYI hónaphatárokat UTC-pillanatra váltjuk
      const [my, mm] = month.split('-').map(Number)
      const startTs = new Date(my, mm - 1, 1).toISOString()
      const endTs = new Date(my, mm, 1).toISOString()
      const [{ data: shifts }, { data: incidents }, { data: cleanings }, { data: geoCk }, { data: issues }, { data: switches }] = await Promise.all([
        supabase.from('shifts').select('*').eq('workspace_id', ws).gte('work_date', start).lt('work_date', end),
        supabase.from('incidents').select('work_date, car_id, user_id, note, created_at')
          .eq('workspace_id', ws).gte('work_date', start).lt('work_date', end),
        supabase.from('cleanings').select('work_date, car_id, user_id, created_at')
          .eq('workspace_id', ws).gte('work_date', start).lt('work_date', end),
        supabase.from('check_ins').select('work_date, car_id, user_id, outside_geofence, out_outside_geofence')
          .eq('workspace_id', ws).gte('work_date', start).lt('work_date', end)
          .or('outside_geofence.eq.true,out_outside_geofence.eq.true'),
        supabase.from('car_issues').select('created_at, car_id, user_id, note, status')
          .eq('workspace_id', ws).gte('created_at', startTs).lt('created_at', endTs),
        supabase.from('check_ins').select('work_date, user_id, car_id, prev_car_id, checked_in_at, switch_reason')
          .eq('workspace_id', ws).gte('work_date', start).lt('work_date', end)
          .not('switch_reason', 'is', null),
      ])
      const ids = [
        ...(shifts ?? []).flatMap((s) => [s.driver_id, s.loader_id]),
        ...(incidents ?? []).map((i) => i.user_id),
        ...(cleanings ?? []).map((c) => c.user_id),
        ...(geoCk ?? []).map((c) => c.user_id),
        ...(issues ?? []).map((i) => i.user_id),
        ...(switches ?? []).map((c) => c.user_id),
      ]
      const names = await resolveNames(ids)
      return {
        shifts: (shifts ?? []) as Shift[],
        incidents: incidents ?? [],
        cleanings: cleanings ?? [],
        geoCheckins: geoCk ?? [],
        issues: (issues ?? []) as MonthData['issues'],
        switches: (switches ?? []) as MonthData['switches'],
        names,
      }
    },
  })

  const cells = useMemo(() => monthGrid(month), [month])

  // Havi összesítő: ki hány napot dolgozott ebben a hónapban (a beosztás alapján).
  // Minden nem-admin/nem-menedzser tag látszik (0 nappal is); vezető csak ha beosztották.
  const monthCounts = useMemo(() => {
    const byUser = new Map<string, Set<string>>()
    for (const s of cal?.shifts ?? []) {
      for (const uid of [s.driver_id, s.loader_id]) {
        if (!uid) continue
        if (!byUser.has(uid)) byUser.set(uid, new Set())
        byUser.get(uid)!.add(s.work_date)
      }
    }
    return (members ?? [])
      .filter((m) => (m.role !== 'admin' && m.role !== 'manager') || (byUser.get(m.id)?.size ?? 0) > 0)
      .map((m) => ({ id: m.id, name: m.full_name || m.email || '—', count: byUser.get(m.id)?.size ?? 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [cal, members])

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, Shift[]>()
    for (const s of cal?.shifts ?? []) {
      if (!map.has(s.work_date)) map.set(s.work_date, [])
      map.get(s.work_date)!.push(s)
    }
    return map
  }, [cal])

  // Autó kategória-rangsora (a kategóriák sorrendje szerint; kategória nélkül a végén)
  const catRank = (cid: string | null) => {
    const c = (cars ?? []).find((x) => x.id === cid)
    if (!c?.category_id) return 9999
    const i = (categories ?? []).findIndex((k) => k.id === c.category_id)
    return i === -1 ? 9999 : i
  }

  // Nap+autó jelzők: esemény / hibabejelentés / takarítás / telephelyen kívül —
  // autónként külön (kulcs: "nap|autóId"; autó nélküli eseménynél "nap|")
  type Marker = { incident: boolean; issue: boolean; clean: boolean; geo: boolean; sw: boolean }
  const markers = useMemo(() => {
    const map = new Map<string, Marker>()
    const get = (d: string, carId: string | null) => {
      const k = `${d}|${carId ?? ''}`
      if (!map.has(k)) map.set(k, { incident: false, issue: false, clean: false, geo: false, sw: false })
      return map.get(k)!
    }
    const carOk = (carId: string | null) => !carFilter || carId === carFilter
    for (const i of cal?.incidents ?? []) if (carOk(i.car_id)) get(i.work_date, i.car_id).incident = true
    for (const i of cal?.issues ?? []) if (carOk(i.car_id)) get(localDateOf(i.created_at), i.car_id).issue = true
    for (const c of cal?.cleanings ?? []) if (carOk(c.car_id)) get(c.work_date, c.car_id).clean = true
    for (const c of cal?.geoCheckins ?? []) if (carOk(c.car_id)) get(c.work_date, c.car_id).geo = true
    for (const c of cal?.switches ?? []) {
      if (carOk(c.car_id)) get(c.work_date, c.car_id).sw = true
      if (c.prev_car_id && carOk(c.prev_car_id)) get(c.work_date, c.prev_car_id).sw = true
    }
    return map
  }, [cal, carFilter])
  const iconsOf = (mk: Marker | undefined) =>
    mk ? `${mk.sw ? '🔁' : ''}${mk.incident ? '⚠️' : ''}${mk.issue ? '❗' : ''}${mk.clean ? '🧽' : ''}${mk.geo ? '📍' : ''}` : ''

  const nameOf = cal?.names ?? {}
  const carOf = (id: string | null) => (cars ?? []).find((c) => c.id === id)
  function tapDay(date: string) {
    // ugyanarra a napra koppintva a kijelölés megszűnik
    setSelectedDate((prev) => (prev === date ? '' : date))
  }

  // Autó havi történet (szűrt nézetben): események + ki volt a páros aznap
  const carHistory = useMemo(() => {
    if (!carFilter || !cal) return []
    type Ev = { sort: string; date: string; icon: string; label: string; who: string | null }
    const evs: Ev[] = []
    for (const i of cal.incidents) if (i.car_id === carFilter)
      evs.push({ sort: i.created_at, date: i.work_date, icon: '⚠️', label: `Esemény/baleset${i.note ? `: ${i.note}` : ''}`, who: nameOf[i.user_id] ?? null })
    for (const i of cal.issues) if (i.car_id === carFilter)
      evs.push({ sort: i.created_at, date: localDateOf(i.created_at), icon: '❗', label: `Hibabejelentés: ${i.note} (${carIssueStatusLabel[i.status]})`, who: nameOf[i.user_id] ?? null })
    for (const c of cal.cleanings) if (c.car_id === carFilter)
      evs.push({ sort: c.created_at, date: c.work_date, icon: '🧽', label: 'Takarítás', who: nameOf[c.user_id] ?? null })
    for (const c of cal.geoCheckins) if (c.car_id === carFilter) {
      if (c.outside_geofence) evs.push({ sort: c.work_date + 'T00', date: c.work_date, icon: '📍', label: 'Telephelyen KÍVÜLI becsekkolás', who: nameOf[c.user_id] ?? null })
      if (c.out_outside_geofence) evs.push({ sort: c.work_date + 'T01', date: c.work_date, icon: '📍', label: 'Telephelyen KÍVÜLI kijelentkezés', who: nameOf[c.user_id] ?? null })
    }
    return evs.sort((a, b) => b.sort.localeCompare(a.sort))
  }, [carFilter, cal, nameOf])

  const pairOf = (date: string, carId: string): string => {
    const s = (shiftsByDay.get(date) ?? []).find((x) => x.car_id === carId)
    if (!s) return 'nincs beosztás'
    if (crewOf(carId) === 1 && !s.loader_id) return shortName(nameOf[s.driver_id ?? ''])
    return `${shortName(nameOf[s.driver_id ?? ''])} + ${shortName(nameOf[s.loader_id ?? ''])}`
  }

  const dayNames = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V']

  return (
    <div className="stack">
      <h2>Beosztás — {currentWorkspace?.name}</h2>

      <SwapApprovals workspaceId={currentWorkspaceId} />

      <div className="tabs" style={{ marginBottom: 0 }}>
        <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>📋 Heti táblázat</button>
        <button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>🗓️ Naptár</button>
      </div>

      {view === 'table' && <WeekTable />}

      {view === 'calendar' && <>
      {/* ---- Havi naptár ---- */}
      <div className="card stack">
        <div className="between">
          <button className="btn ghost sm auto" onClick={() => setMonth(shiftMonth(month, -1))}>←</button>
          <div className="card-title" style={{ margin: 0 }}>{monthTitle(month)}</div>
          <button className="btn ghost sm auto" onClick={() => setMonth(shiftMonth(month, 1))}>→</button>
        </div>

        <div className="field">
          <label>Autó-szűrő</label>
          <select className="select" value={carFilter} onChange={(e) => setCarFilter(e.target.value)}>
            <option value="">Összes autó</option>
            {cars?.map((c) => <option key={c.id} value={c.id}>{c.plate}</option>)}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
          {dayNames.map((d) => (
            <div key={d} className="tiny muted" style={{ textAlign: 'center', padding: '2px 0' }}>{d}</div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div key={`e${i}`} onClick={() => setSelectedDate('')} />
            const all = shiftsByDay.get(date) ?? []
            const ds = (carFilter ? all.filter((s) => s.car_id === carFilter) : all)
              .slice()
              .sort((a, b) => catRank(a.car_id) - catRank(b.car_id)
                || (carOf(a.car_id)?.plate ?? '').localeCompare(carOf(b.car_id)?.plate ?? ''))
            // A nap be nem osztott autóihoz / autó nélküli eseményekhez tartozó jelzők alul összegezve
            const shiftCarIds = new Set(ds.map((s) => s.car_id))
            const rest: Marker = { incident: false, issue: false, clean: false, geo: false, sw: false }
            for (const [k, v] of markers) {
              if (!k.startsWith(`${date}|`)) continue
              const cid = k.slice(date.length + 1)
              if (cid && shiftCarIds.has(cid)) continue
              rest.incident ||= v.incident; rest.issue ||= v.issue; rest.clean ||= v.clean; rest.geo ||= v.geo; rest.sw ||= v.sw
            }
            const icons = iconsOf(rest.incident || rest.issue || rest.clean || rest.geo || rest.sw ? rest : undefined)
            const isSel = date === selectedDate
            const isToday = date === today
            return (
              <button
                key={date}
                onClick={() => tapDay(date)}
                style={{
                  minHeight: 64, padding: '3px 2px', borderRadius: 8, cursor: 'pointer',
                  border: isSel ? '2px solid var(--primary)' : '1px solid transparent',
                  background: isToday ? 'rgba(20,184,166,.12)' : 'var(--bg)',
                  color: 'inherit', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'stretch',
                  transform: isSel ? 'scale(1.14)' : undefined, zIndex: isSel ? 2 : undefined,
                  boxShadow: isSel ? 'var(--shadow)' : undefined, transition: 'transform .12s ease',
                }}
              >
                <div className="tiny" style={{ fontWeight: isToday ? 800 : 500 }}>{Number(date.slice(8, 10))}</div>
                {ds.slice(0, 3).map((s, ci, arr) => {
                  const full = !!s.driver_id && (!!s.loader_id || crewOf(s.car_id) === 1)
                  const chipIcons = iconsOf(markers.get(`${date}|${s.car_id}`))
                  const label = (carFilter
                    ? `${shortName(nameOf[s.driver_id ?? ''])}+${shortName(nameOf[s.loader_id ?? ''])}`
                    : carOf(s.car_id)?.plate ?? '?') + (chipIcons ? ` ${chipIcons}` : '')
                  const catBreak = ci > 0 && catRank(arr[ci - 1].car_id) !== catRank(s.car_id)
                  return (
                    <Fragment key={s.id}>
                    {catBreak && <div style={{ height: 1, background: 'var(--border)', margin: '1px 2px' }} />}
                    <div
                      style={{
                        fontSize: 8.5, lineHeight: '11px', borderRadius: 4, padding: '1px 2px',
                        background: full ? 'rgba(20,184,166,.22)' : 'rgba(234,179,8,.25)',
                        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                      }}
                      title={`${carOf(s.car_id)?.plate ?? ''}: ${nameOf[s.driver_id ?? ''] ?? '—'} + ${nameOf[s.loader_id ?? ''] ?? '—'}`}
                    >
                      {label}
                    </div>
                    </Fragment>
                  )
                })}
                {ds.length > 3 && <div style={{ fontSize: 8.5 }} className="muted">+{ds.length - 3}</div>}
                {icons && <div style={{ fontSize: 9, lineHeight: '11px' }}>{icons}</div>}
              </button>
            )
          })}
        </div>
        <div className="tiny muted" style={{ textAlign: 'center' }}>
          <span style={{ background: 'rgba(20,184,166,.22)', borderRadius: 4, padding: '0 6px' }}>teljes páros</span>{' '}
          <span style={{ background: 'rgba(234,179,8,.25)', borderRadius: 4, padding: '0 6px' }}>hiányos</span>
          {' '}· 🔁 autócsere · ⚠️ baleset · ❗ hibabejelentés · 🧽 takarítás · 📍 telephelyen kívül
        </div>
      </div>

      {/* ---- Kiválasztott nap részletei ---- */}
      {cal && selectedDate && (() => {
        const d = selectedDate
        const carOk = (cid: string | null) => !carFilter || cid === carFilter
        const dShifts = (shiftsByDay.get(d) ?? []).filter((x) => carOk(x.car_id))
          .slice()
          .sort((a, b) => catRank(a.car_id) - catRank(b.car_id)
            || (carOf(a.car_id)?.plate ?? '').localeCompare(carOf(b.car_id)?.plate ?? ''))
        const inc = (cal.incidents ?? []).filter((i) => i.work_date === d && carOk(i.car_id))
        const iss = (cal.issues ?? []).filter((i) => localDateOf(i.created_at) === d && carOk(i.car_id))
        const cln = (cal.cleanings ?? []).filter((c) => c.work_date === d && carOk(c.car_id))
        const geo = (cal.geoCheckins ?? []).filter((c) => c.work_date === d && carOk(c.car_id))
        const sw = (cal.switches ?? []).filter((c) => c.work_date === d && (carOk(c.car_id) || carOk(c.prev_car_id)))
        const tt = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
        const plate = (cid: string | null) => carOf(cid)?.plate ?? '?'
        const catName = (cid: string | null) => {
          const c = carOf(cid)
          return c?.category_id ? (categories ?? []).find((k) => k.id === c.category_id)?.name ?? null : null
        }
        const carFull = (cid: string | null) => `${catName(cid) ? `${catName(cid)} · ` : ''}${plate(cid)}`
        const empty = dShifts.length + inc.length + iss.length + cln.length + geo.length + sw.length === 0
        return (
          <div className="card stack" style={{ borderColor: 'var(--primary)' }}>
            <div className="between">
              <div className="card-title" style={{ margin: 0 }}>📅 {formatDate(d)} — mi történt aznap</div>
              <button className="btn ghost sm auto" title="Kijelölés megszüntetése" onClick={() => setSelectedDate('')}>✕</button>
            </div>
            {empty && <div className="tiny muted">Ezen a napon nincs beosztás és esemény. Koppints egy másik napra a naptárban.</div>}
            {dShifts.length > 0 && (() => {
              // Kategóriánként hány autó ment aznap
              const counts = new Map<string, number>()
              for (const x of dShifts) {
                const n = catName(x.car_id) ?? 'Kategória nélkül'
                counts.set(n, (counts.get(n) ?? 0) + 1)
              }
              return (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className="tiny muted" style={{ alignSelf: 'center' }}>Aznap ment:</span>
                  {[...counts.entries()].map(([n, c]) => (
                    <span key={n} className="badge primary">{n}: {c} db</span>
                  ))}
                  <span className="badge">összesen {dShifts.length} autó</span>
                </div>
              )
            })()}
            {dShifts.map((x, di) => (
              <Fragment key={x.id}>
              {di > 0 && catRank(dShifts[di - 1].car_id) !== catRank(x.car_id) && (
                <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
              )}
              <div className="between" style={{ gap: 8 }}>
                <span className="small" style={{ fontWeight: 700 }}>
                  <span className="tiny muted" style={{ fontWeight: 400 }}>{catName(x.car_id) ? `${catName(x.car_id)} · ` : ''}</span>
                  🚚 {plate(x.car_id)} {iconsOf(markers.get(`${d}|${x.car_id}`))}
                </span>
                <span className="small muted">
                  {nameOf[x.driver_id ?? ''] ?? '—'}
                  {crewOf(x.car_id) === 2 || x.loader_id ? ` + ${nameOf[x.loader_id ?? ''] ?? '—'}` : ''}
                </span>
              </div>
              </Fragment>
            ))}
            {dShifts.length > 0 && (sw.length + inc.length + iss.length + cln.length + geo.length) > 0 && (
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            )}
            {sw.map((c, idx) => (
              <div key={`s${idx}`} className="stack" style={{ gap: 2, borderLeft: '3px solid var(--primary)', paddingLeft: 10 }}>
                <span className="tiny" style={{ fontWeight: 700 }}>
                  🔁 Autócsere — {nameOf[c.user_id] ?? 'munkatárs'}: {carFull(c.prev_car_id)} → {carFull(c.car_id)} · {tt(c.checked_in_at)}
                </span>
                <span className="small">{c.switch_reason}</span>
              </div>
            ))}
            {inc.map((i, idx) => (
              <div key={`i${idx}`} className="stack" style={{ gap: 2, borderLeft: '3px solid var(--danger)', paddingLeft: 10 }}>
                <span className="tiny" style={{ fontWeight: 700 }}>
                  ⚠️ Esemény / baleset — {i.car_id ? `${carFull(i.car_id)} · ` : ''}{nameOf[i.user_id] ?? 'munkatárs'} · {tt(i.created_at)}
                </span>
                <span className="small">{i.note || '(nincs leírás)'}</span>
              </div>
            ))}
            {iss.map((i, idx) => (
              <div key={`h${idx}`} className="stack" style={{ gap: 2, borderLeft: '3px solid var(--warning)', paddingLeft: 10 }}>
                <span className="tiny" style={{ fontWeight: 700 }}>
                  ❗ Hibabejelentés — {carFull(i.car_id)} · {nameOf[i.user_id] ?? 'munkatárs'} · {tt(i.created_at)} · {carIssueStatusLabel[i.status] ?? i.status}
                </span>
                <span className="small">{i.note || '(nincs leírás)'}</span>
              </div>
            ))}
            {cln.map((c, idx) => (
              <div key={`c${idx}`} className="tiny" style={{ paddingLeft: 13 }}>
                🧽 Takarítás — {plate(c.car_id)} · {nameOf[c.user_id] ?? 'munkatárs'} · {tt(c.created_at)}
              </div>
            ))}
            {geo.map((g, idx) => (
              <Fragment key={`g${idx}`}>
                {g.outside_geofence && (
                  <div className="tiny" style={{ paddingLeft: 13 }}>
                    📍 <strong>Bejelentkezés</strong> telephelyen kívül — {carFull(g.car_id)} · {nameOf[g.user_id] ?? 'munkatárs'}
                  </div>
                )}
                {g.out_outside_geofence && (
                  <div className="tiny" style={{ paddingLeft: 13 }}>
                    🏁 <strong>Kijelentkezés</strong> telephelyen kívül — {carFull(g.car_id)} · {nameOf[g.user_id] ?? 'munkatárs'}
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )
      })()}

      <div className="card stack">
        <div className="card-title">👥 Napok ebben a hónapban — {monthTitle(month)}</div>
        {monthCounts.length === 0 && <div className="tiny muted">Nincs munkatárs ezen a munkaterületen.</div>}
        <div className="grid-2">
          {monthCounts.map((r) => (
            <div key={r.id} className="between">
              <span className="small" style={{ fontWeight: r.count > 0 ? 700 : 400, color: r.count === 0 ? 'var(--text-dim)' : undefined }}>{r.name}</span>
              <span className={`badge ${r.count > 0 ? 'primary' : ''}`}>{r.count} nap</span>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Autó havi történet (szűrt nézetben) ---- */}
      {carFilter && (
        <div className="card stack">
          <div className="card-title">📜 {carOf(carFilter)?.plate} — {monthTitle(month)} történet</div>
          {carHistory.length === 0 && <div className="tiny muted">Ebben a hónapban nincs esemény ennél az autónál.</div>}
          {carHistory.map((e, i) => (
            <div key={i} className="between" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div>
                <div className="small">{e.icon} {e.label}</div>
                <div className="tiny muted">
                  {formatDate(e.date)}{e.who ? ` · ${e.who}` : ''} · páros: {pairOf(e.date, carFilter)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      </>}
    </div>
  )
}
