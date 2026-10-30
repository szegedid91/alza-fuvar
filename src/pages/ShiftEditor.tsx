import { Fragment, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useMembers } from '../hooks/useMembers'
import { useCars } from '../hooks/useCars'
import { useCarCategories } from '../hooks/useCarCategories'
import { useRoutes } from '../hooks/useRoutes'
import { fetchAll } from '../lib/fetchAll'
import { resolveNames } from '../lib/names'
import { todayISO, formatDate, carIssueStatusLabel } from '../lib/labels'
import { monthGrid, shiftMonth, localDateOf, monthTitle, shortName, crewSizeFor, groupByCategory } from '../lib/calendar'
import SwapApprovals from './shift/SwapApprovals'
import WeekTable from './shift/WeekTable'
import Icon, { type IconName } from '../components/Icon'
import type { Tables } from '../lib/database.types'

type Shift = Tables<'shifts'>

// A beosztás-szerkesztő három részből áll:
//  - SwapApprovals (shift/): függő cserekérések jóváhagyása
//  - WeekTable (shift/): heti, Sheets-szerű táblázat (cellánkénti mentés)
//  - itt: a havi naptár-nézet + napi részletek + autó-történet
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
  const { data: cars } = useCars()  // archivált autók is: a régi beosztásokban a rendszám maradjon olvasható
  const { data: categories } = useCarCategories()
  const { data: routes } = useRoutes()
  const routeCode = (id: string | null | undefined) => (routes ?? []).find((r) => r.id === id)?.code ?? null
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
      // Lapozva (1000 sor felett is teljes) és hibánál dob — csonka naptár
      // félrevezetne: üresnek látszó napokra a bér ugyanúgy fizet
      const [shifts, incidents, cleanings, geoCk, issues, switches] = await Promise.all([
        fetchAll((f, t) => supabase.from('shifts').select('*')
          .eq('workspace_id', ws).gte('work_date', start).lt('work_date', end).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('incidents').select('work_date, car_id, user_id, note, created_at')
          .eq('workspace_id', ws).gte('work_date', start).lt('work_date', end).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('cleanings').select('work_date, car_id, user_id, created_at')
          .eq('workspace_id', ws).gte('work_date', start).lt('work_date', end).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('check_ins').select('work_date, car_id, user_id, outside_geofence, out_outside_geofence')
          .eq('workspace_id', ws).gte('work_date', start).lt('work_date', end)
          .or('outside_geofence.eq.true,out_outside_geofence.eq.true').order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('car_issues').select('created_at, car_id, user_id, note, status')
          .eq('workspace_id', ws).gte('created_at', startTs).lt('created_at', endTs).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('check_ins').select('work_date, user_id, car_id, prev_car_id, checked_in_at, switch_reason')
          .eq('workspace_id', ws).gte('work_date', start).lt('work_date', end)
          .not('switch_reason', 'is', null).order('id').range(f, t)),
      ])
      const ids = [
        ...(shifts ?? []).flatMap((s) => [s.driver_id, s.loader_id, s.trainee_id]),
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
      for (const uid of [s.driver_id, s.loader_id, s.trainee_id]) {
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
  // A jelzők ikonjai, színei és a jelmagyarázat — egy helyen, hogy a naptár-
  // cella, a napi részletek és a jelmagyarázat ugyanazt mutassa
  const MARK: { key: keyof Marker; icon: IconName; color: string; label: string }[] = [
    { key: 'sw', icon: 'repeat', color: 'var(--primary)', label: 'autócsere' },
    { key: 'incident', icon: 'alert-triangle', color: 'var(--danger)', label: 'baleset' },
    { key: 'issue', icon: 'wrench', color: 'var(--warning)', label: 'hibabejelentés' },
    { key: 'clean', icon: 'sparkles', color: 'var(--success)', label: 'takarítás' },
    { key: 'geo', icon: 'map-pin', color: 'var(--warning)', label: 'telephelyen kívül' },
  ]
  const iconsOf = (mk: Marker | undefined, size = 10) => {
    const on = MARK.filter((m) => mk?.[m.key])
    if (on.length === 0) return null
    return (
      <span style={{ display: 'inline-flex', gap: 2, verticalAlign: -1 }}>
        {on.map((m) => <Icon key={m.key} name={m.icon} size={size} style={{ color: m.color }} title={m.label} />)}
      </span>
    )
  }

  const nameOf = cal?.names ?? {}
  const carOf = (id: string | null) => (cars ?? []).find((c) => c.id === id)
  function tapDay(date: string) {
    // ugyanarra a napra koppintva a kijelölés megszűnik
    setSelectedDate((prev) => (prev === date ? '' : date))
  }

  // Autó havi történet (szűrt nézetben): események + ki volt a páros aznap
  const carHistory = useMemo(() => {
    if (!carFilter || !cal) return []
    type Ev = { sort: string; date: string; icon: IconName; color: string; label: string; who: string | null }
    const evs: Ev[] = []
    for (const i of cal.incidents) if (i.car_id === carFilter)
      evs.push({ sort: i.created_at, date: i.work_date, icon: 'alert-triangle', color: 'var(--danger)', label: `Esemény / baleset${i.note ? `: ${i.note}` : ''}`, who: nameOf[i.user_id] ?? null })
    for (const i of cal.issues) if (i.car_id === carFilter)
      evs.push({ sort: i.created_at, date: localDateOf(i.created_at), icon: 'wrench', color: 'var(--warning)', label: `Hibabejelentés: ${i.note} (${carIssueStatusLabel[i.status]})`, who: nameOf[i.user_id] ?? null })
    for (const c of cal.cleanings) if (c.car_id === carFilter)
      evs.push({ sort: c.created_at, date: c.work_date, icon: 'sparkles', color: 'var(--success)', label: 'Takarítás', who: nameOf[c.user_id] ?? null })
    for (const c of cal.switches) if (c.car_id === carFilter || c.prev_car_id === carFilter)
      evs.push({ sort: c.checked_in_at, date: c.work_date, icon: 'repeat', color: 'var(--primary)',
        label: `Autócsere: ${carOf(c.prev_car_id)?.plate ?? '?'} → ${carOf(c.car_id)?.plate ?? '?'}${c.switch_reason ? ` — ${c.switch_reason}` : ''}`, who: nameOf[c.user_id] ?? null })
    for (const c of cal.geoCheckins) if (c.car_id === carFilter) {
      if (c.outside_geofence) evs.push({ sort: c.work_date + 'T00', date: c.work_date, icon: 'map-pin', color: 'var(--warning)', label: 'Telephelyen KÍVÜLI becsekkolás', who: nameOf[c.user_id] ?? null })
      if (c.out_outside_geofence) evs.push({ sort: c.work_date + 'T01', date: c.work_date, icon: 'flag', color: 'var(--warning)', label: 'Telephelyen KÍVÜLI kijelentkezés', who: nameOf[c.user_id] ?? null })
    }
    return evs.sort((a, b) => b.sort.localeCompare(a.sort))
  }, [carFilter, cal, nameOf])

  // Egy beosztás-sor emberei röviden: sofőr (+ rakodó) (+ betanuló)
  const crewText = (s: Shift): string => {
    const parts = [shortName(nameOf[s.driver_id ?? ''])]
    const rc = routeCode(s.route_id)
    if (crewOf(s.car_id) === 2 || s.loader_id) parts.push(shortName(nameOf[s.loader_id ?? '']))
    let t = (rc ? `[${rc}] ` : '') + parts.join(' + ')
    if (s.trainee_id) t += ` + bet.: ${shortName(nameOf[s.trainee_id])}`
    return t
  }
  const pairOf = (date: string, carId: string): string => {
    const ss = (shiftsByDay.get(date) ?? []).filter((x) => x.car_id === carId).sort((a, b) => (a.round ?? 1) - (b.round ?? 1))
    if (ss.length === 0) return 'nincs beosztás'
    return ss.map((s) => (ss.length > 1 ? `${s.round ?? 1}. kör: ${crewText(s)}` : crewText(s))).join(' · ')
  }

  const dayNames = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V']

  return (
    <div className="stack">
      <h2>Beosztás — {currentWorkspace?.name}</h2>

      <SwapApprovals workspaceId={currentWorkspaceId} />
      <Link to="/jaratok" className="card between" style={{ textDecoration: 'none', color: 'inherit', padding: 12 }}>
        <div className="card-title" style={{ margin: 0 }}><Icon name="map" />Járatok{(routes?.length ?? 0) ? ` (${routes!.map((r) => r.code).join(', ')})` : ''}</div>
        <span className="tiny muted row" style={{ gap: 4 }}>járatok és boxok kezelése <Icon name="chevron-right" size={14} /></span>
      </Link>

      <div className="tabs" style={{ marginBottom: 0 }}>
        <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}><Icon name="clipboard" size={18} />Heti táblázat</button>
        <button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}><Icon name="calendar" size={18} />Naptár</button>
      </div>

      {view === 'table' && <WeekTable />}

      {view === 'calendar' && <>
      {/* ---- Havi naptár ---- */}
      <div className="card stack">
        <div className="between">
          <button className="icon-btn" aria-label="Előző hónap" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="chevron-left" /></button>
          <div className="card-title" style={{ margin: 0 }}>{monthTitle(month)}</div>
          <button className="icon-btn" aria-label="Következő hónap" onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="chevron-right" /></button>
        </div>

        <div className="field">
          <label>Autó-szűrő</label>
          <select className="select" value={carFilter} onChange={(e) => setCarFilter(e.target.value)}>
            <option value="">Összes autó</option>
            {groupByCategory(cars ?? [], categories).map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.cars.map((c) => <option key={c.id} value={c.id}>{c.plate}{c.active ? '' : ' (inaktív)'}</option>)}
              </optgroup>
            ))}
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
                || (carOf(a.car_id)?.plate ?? '').localeCompare(carOf(b.car_id)?.plate ?? '')
                || (a.round ?? 1) - (b.round ?? 1))
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
                  const chipIcons = iconsOf(markers.get(`${date}|${s.car_id}`), 9)
                  const label = (s.round === 2 ? '2.k ' : '') + (carFilter
                    ? crewText(s).replace(' + ', '+')
                    : carOf(s.car_id)?.plate ?? '?')
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
                      title={`${carOf(s.car_id)?.plate ?? ''}${s.round === 2 ? ' (2. kör)' : ''}: ${nameOf[s.driver_id ?? ''] ?? '—'}${s.loader_id ? ` + ${nameOf[s.loader_id] ?? '—'}` : ''}${s.trainee_id ? ` + betanuló: ${nameOf[s.trainee_id] ?? '—'}` : ''}`}
                    >
                      {label}{chipIcons && <> {chipIcons}</>}
                    </div>
                    </Fragment>
                  )
                })}
                {ds.length > 3 && <div style={{ fontSize: 8.5 }} className="muted">+{ds.length - 3}</div>}
                {icons && <div style={{ lineHeight: '11px' }}>{icons}</div>}
              </button>
            )
          })}
        </div>
        {/* Jelmagyarázat: tördelődő sor — telefonon 2-3 sorba esik, nem lóg ki */}
        <div className="tiny muted" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 12px' }}>
          <span style={{ background: 'rgba(20,184,166,.22)', borderRadius: 4, padding: '0 6px' }}>teljes páros</span>
          <span style={{ background: 'rgba(234,179,8,.25)', borderRadius: 4, padding: '0 6px' }}>hiányos</span>
          {MARK.map((m) => (
            <span key={m.key} style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name={m.icon} size={12} style={{ color: m.color }} />{m.label}
            </span>
          ))}
        </div>
      </div>

      {/* ---- Kiválasztott nap részletei ---- */}
      {cal && selectedDate && (() => {
        const d = selectedDate
        const carOk = (cid: string | null) => !carFilter || cid === carFilter
        const dShifts = (shiftsByDay.get(d) ?? []).filter((x) => carOk(x.car_id))
          .slice()
          .sort((a, b) => catRank(a.car_id) - catRank(b.car_id)
            || (carOf(a.car_id)?.plate ?? '').localeCompare(carOf(b.car_id)?.plate ?? '')
            || (a.round ?? 1) - (b.round ?? 1))
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
              <div className="card-title" style={{ margin: 0 }}><Icon name="calendar" />{formatDate(d)} — mi történt aznap</div>
              <button className="icon-btn" title="Kijelölés megszüntetése" aria-label="Kijelölés megszüntetése" onClick={() => setSelectedDate('')}><Icon name="x" /></button>
            </div>
            {empty && <div className="tiny muted">Ezen a napon nincs beosztás és esemény. Koppints egy másik napra a naptárban.</div>}
            {dShifts.length > 0 && (() => {
              // Kategóriánként hány autó ment aznap (a 2. kör ugyanaz az autó — nem számol duplán)
              const counts = new Map<string, number>()
              const seenCar = new Set<string>()
              for (const x of dShifts) {
                if (seenCar.has(x.car_id)) continue
                seenCar.add(x.car_id)
                const n = catName(x.car_id) ?? 'Kategória nélkül'
                counts.set(n, (counts.get(n) ?? 0) + 1)
              }
              return (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className="tiny muted" style={{ alignSelf: 'center' }}>Aznap ment:</span>
                  {[...counts.entries()].map(([n, c]) => (
                    <span key={n} className="badge primary">{n}: {c} db</span>
                  ))}
                  <span className="badge">összesen {new Set(dShifts.map((x) => x.car_id)).size} autó</span>
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
                  <Icon name="truck" size={14} style={{ verticalAlign: -2 }} /> {plate(x.car_id)} {routeCode(x.route_id) && <span className="badge" style={{ fontSize: 10, padding: '0 6px' }}>{routeCode(x.route_id)} kör</span>} {x.round === 2 && <span className="badge primary" style={{ fontSize: 10, padding: '0 6px' }}>2. kör</span>} {iconsOf(markers.get(`${d}|${x.car_id}`), 12)}
                </span>
                <span className="small muted" style={{ textAlign: 'right' }}>
                  {nameOf[x.driver_id ?? ''] ?? '—'}
                  {crewOf(x.car_id) === 2 || x.loader_id ? ` + ${nameOf[x.loader_id ?? ''] ?? '—'}` : ''}
                  {x.trainee_id && <span className="tiny" style={{ display: 'block' }}>betanuló: {nameOf[x.trainee_id] ?? '—'}</span>}
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
                  <Icon name="repeat" size={12} style={{ color: 'var(--primary)', verticalAlign: -2 }} /> Autócsere — {nameOf[c.user_id] ?? 'munkatárs'}: {carFull(c.prev_car_id)} → {carFull(c.car_id)} · {tt(c.checked_in_at)}
                </span>
                <span className="small">{c.switch_reason}</span>
              </div>
            ))}
            {inc.map((i, idx) => (
              <div key={`i${idx}`} className="stack" style={{ gap: 2, borderLeft: '3px solid var(--danger)', paddingLeft: 10 }}>
                <span className="tiny" style={{ fontWeight: 700 }}>
                  <Icon name="alert-triangle" size={12} style={{ color: 'var(--danger)', verticalAlign: -2 }} /> Esemény / baleset — {i.car_id ? `${carFull(i.car_id)} · ` : ''}{nameOf[i.user_id] ?? 'munkatárs'} · {tt(i.created_at)}
                </span>
                <span className="small">{i.note || '(nincs leírás)'}</span>
              </div>
            ))}
            {iss.map((i, idx) => (
              <div key={`h${idx}`} className="stack" style={{ gap: 2, borderLeft: '3px solid var(--warning)', paddingLeft: 10 }}>
                <span className="tiny" style={{ fontWeight: 700 }}>
                  <Icon name="wrench" size={12} style={{ color: 'var(--warning)', verticalAlign: -2 }} /> Hibabejelentés — {carFull(i.car_id)} · {nameOf[i.user_id] ?? 'munkatárs'} · {tt(i.created_at)} · {carIssueStatusLabel[i.status] ?? i.status}
                </span>
                <span className="small">{i.note || '(nincs leírás)'}</span>
              </div>
            ))}
            {cln.map((c, idx) => (
              <div key={`c${idx}`} className="tiny" style={{ paddingLeft: 13 }}>
                <Icon name="sparkles" size={12} style={{ color: 'var(--success)', verticalAlign: -2 }} /> Takarítás — {plate(c.car_id)} · {nameOf[c.user_id] ?? 'munkatárs'} · {tt(c.created_at)}
              </div>
            ))}
            {geo.map((g, idx) => (
              <Fragment key={`g${idx}`}>
                {g.outside_geofence && (
                  <div className="tiny" style={{ paddingLeft: 13 }}>
                    <Icon name="map-pin" size={12} style={{ color: 'var(--warning)', verticalAlign: -2 }} /> <strong>Bejelentkezés</strong> telephelyen kívül — {carFull(g.car_id)} · {nameOf[g.user_id] ?? 'munkatárs'}
                  </div>
                )}
                {g.out_outside_geofence && (
                  <div className="tiny" style={{ paddingLeft: 13 }}>
                    <Icon name="flag" size={12} style={{ color: 'var(--warning)', verticalAlign: -2 }} /> <strong>Kijelentkezés</strong> telephelyen kívül — {carFull(g.car_id)} · {nameOf[g.user_id] ?? 'munkatárs'}
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )
      })()}

      <div className="card stack">
        <div className="card-title"><Icon name="users" />Napok ebben a hónapban — {monthTitle(month)}</div>
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
          <div className="card-title"><Icon name="history" />{carOf(carFilter)?.plate} — {monthTitle(month)} történet</div>
          {carHistory.length === 0 && <div className="tiny muted">Ebben a hónapban nincs esemény ennél az autónál.</div>}
          {carHistory.map((e, i) => (
            <div key={i} className="between" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div>
                <div className="small row" style={{ gap: 6, alignItems: 'flex-start' }}><Icon name={e.icon} size={14} style={{ color: e.color, flexShrink: 0, marginTop: 2 }} /><span>{e.label}</span></div>
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
