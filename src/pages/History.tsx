import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useWorkspace } from '../context/WorkspaceContext'
import { resolveNames } from '../lib/names'
import { todayISO, formatDate, formatDateTime, carIssueStatusLabel } from '../lib/labels'
import CarTimeline, { type TimelineEntry } from '../components/CarTimeline'
import type { Enums } from '../lib/database.types'

type CheckIn = {
  car_id: string
  prev_car_id: string | null
  user_id: string
  work_date: string
  checked_in_at: string
  checked_out_at: string | null
  switch_reason: string | null
}
type Incident = { id: string; car_id: string | null; user_id: string; work_date: string; note: string | null; created_at: string }
type Issue = { id: string; car_id: string; user_id: string; note: string | null; status: Enums<'car_issue_status'>; created_at: string }

function isoDaysAgo(n: number): string {
  // Naptári nappal számolunk (nem 24 órával) — óraátállításnál sem csúszik el
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Helyi naptári nap egy UTC-időbélyegből (a .slice(0,10) az UTC-napot adná!)
function localDateOf(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Vezetői előzmény-nézet: visszamenőleg (akár évekre) mutatja, melyik napon
// melyik autók mentek, milyen napközbeni autócserék és események/hibák voltak.
export default function History() {
  const { currentWorkspaceId } = useWorkspace()
  const today = todayISO()

  const [from, setFrom] = useState(() => isoDaysAgo(30))
  const [to, setTo] = useState(today)
  const [filterCar, setFilterCar] = useState('')
  const [filterPerson, setFilterPerson] = useState('')
  const [filterType, setFilterType] = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['history', currentWorkspaceId, from, to],
    enabled: !!currentWorkspaceId && from <= to,
    queryFn: async () => {
      const ws = currentWorkspaceId!
      const [carsRes, checkins, incidents, issues] = await Promise.all([
        supabase.from('cars').select('id, plate, category:car_categories(name)').eq('workspace_id', ws),
        fetchAll<CheckIn>((f, t) => supabase.from('check_ins')
          .select('car_id, prev_car_id, user_id, work_date, checked_in_at, checked_out_at, switch_reason')
          .eq('workspace_id', ws).gte('work_date', from).lte('work_date', to)
          .order('checked_in_at').range(f, t)),
        fetchAll<Incident>((f, t) => supabase.from('incidents')
          .select('id, car_id, user_id, work_date, note, created_at')
          .eq('workspace_id', ws).gte('work_date', from).lte('work_date', to)
          .order('created_at').range(f, t)),
        fetchAll<Issue>((f, t) => supabase.from('car_issues')
          .select('id, car_id, user_id, note, status, created_at')
          .eq('workspace_id', ws)
          .gte('created_at', new Date(`${from}T00:00:00`).toISOString())
          .lte('created_at', new Date(`${to}T23:59:59.999`).toISOString())
          .order('created_at').range(f, t)),
      ])
      if (carsRes.error) throw carsRes.error
      const names = await resolveNames([
        ...checkins.map((c) => c.user_id),
        ...incidents.map((i) => i.user_id),
        ...issues.map((i) => i.user_id),
      ])
      return { cars: carsRes.data ?? [], checkins, incidents, issues, names }
    },
  })

  const plateOf = useMemo(() => new Map((data?.cars ?? []).map((c) => [c.id, c.plate])), [data])
  const catOf = useMemo(() => new Map((data?.cars ?? []).map((c) => [
    c.id, (c.category as unknown as { name: string } | null)?.name ?? null,
  ])), [data])
  // Kategória-előtaggal ellátott autónév (pl. "XL · ABC-123")
  const carLabel = (carId: string | null) => {
    if (!carId) return '?'
    const cat = catOf.get(carId)
    return `${cat ? `${cat} · ` : ''}${plateOf.get(carId) ?? '?'}`
  }
  const nm = (id: string | null) => (id ? data?.names[id] ?? 'munkatárs' : null)

  // Szűrők alkalmazása + napi csoportosítás (csökkenő dátum szerint)
  const view = useMemo(() => {
    if (!data) return null
    const okCar = (cid: string | null) => !filterCar || cid === filterCar
    const okPerson = (uid: string | null) => !filterPerson || uid === filterPerson

    const checkins = data.checkins.filter((c) => (okCar(c.car_id) || okCar(c.prev_car_id)) && okPerson(c.user_id))
    const incidents = data.incidents.filter((i) => okCar(i.car_id) && okPerson(i.user_id))
    const issues = data.issues.filter((i) => okCar(i.car_id) && okPerson(i.user_id))
    const switches = checkins.filter((c) => c.switch_reason != null)

    // Statisztika: cserék okok szerint (a kettőspont előtti fő ok alapján)
    const reasonCounts = new Map<string, number>()
    for (const s of switches) {
      const key = (s.switch_reason ?? '').split(':')[0].trim() || 'Egyéb'
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1)
    }

    interface DayGroup {
      date: string
      // autónként: ki mettől meddig használta
      usage: { carId: string; plate: string; segments: { who: string; from: string; to: string | null }[] }[]
      switches: { who: string; fromPlate: string; toPlate: string; at: string; reason: string }[]
      timelines: { userId: string; who: string; entries: TimelineEntry[] }[]
      incidents: Incident[]
      issues: Issue[]
    }
    const dayMap = new Map<string, DayGroup>()
    const day = (date: string): DayGroup => {
      let g = dayMap.get(date)
      if (!g) { g = { date, usage: [], switches: [], timelines: [], incidents: [], issues: [] }; dayMap.set(date, g) }
      return g
    }

    // Autóhasználat naponta és autónként
    for (const c of checkins) {
      const g = day(c.work_date)
      let u = g.usage.find((x) => x.carId === c.car_id)
      if (!u) { u = { carId: c.car_id, plate: plateOf.get(c.car_id) ?? '?', segments: [] }; g.usage.push(u) }
      u.segments.push({ who: nm(c.user_id) ?? '?', from: c.checked_in_at, to: c.checked_out_at })
    }

    // Autócserék + a váltó ember napi idővonala
    const byUserDay = new Map<string, CheckIn[]>()
    for (const c of checkins) {
      const key = `${c.user_id}|${c.work_date}`
      byUserDay.set(key, [...(byUserDay.get(key) ?? []), c])
    }
    for (const s of switches) {
      const g = day(s.work_date)
      g.switches.push({
        who: nm(s.user_id) ?? '?',
        fromPlate: s.prev_car_id ? plateOf.get(s.prev_car_id) ?? '?' : '?',
        toPlate: plateOf.get(s.car_id) ?? '?',
        at: s.checked_in_at,
        reason: s.switch_reason ?? '',
      })
      if (!g.timelines.some((t) => t.userId === s.user_id)) {
        const rows = byUserDay.get(`${s.user_id}|${s.work_date}`) ?? []
        g.timelines.push({
          userId: s.user_id,
          who: nm(s.user_id) ?? '?',
          entries: rows.map((r) => ({
            plate: plateOf.get(r.car_id) ?? '?',
            from: r.checked_in_at, to: r.checked_out_at, reason: r.switch_reason,
          })),
        })
      }
    }

    for (const i of incidents) day(i.work_date).incidents.push(i)
    for (const i of issues) day(localDateOf(i.created_at)).issues.push(i)

    const days = [...dayMap.values()].sort((a, b) => b.date.localeCompare(a.date))

    return {
      days,
      stats: {
        dayCount: new Set(checkins.map((c) => c.work_date)).size,
        switchCount: switches.length,
        incidentCount: incidents.length,
        issueCount: issues.length,
        reasons: [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]),
      },
      people: [...new Set([...checkins.map((c) => c.user_id), ...incidents.map((i) => i.user_id), ...issues.map((i) => i.user_id)])]
        .map((id) => ({ id, name: data.names[id] ?? 'munkatárs' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'hu')),
    }
  }, [data, filterCar, filterPerson, plateOf]) // eslint-disable-line react-hooks/exhaustive-deps

  const show = (what: string) => !filterType || filterType === what
  const t = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="stack">
      <h2>Előzmények</h2>
      <p className="small muted">Visszamenőleg: melyik napon melyik autók mentek, autócserék és okaik, események, hibák.</p>

      <div className="card stack" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 130px' }}>
            <label>Ettől</label>
            <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 130px' }}>
            <label>Eddig</label>
            <input className="input" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost sm" onClick={() => { setFrom(isoDaysAgo(30)); setTo(today) }}>30 nap</button>
          <button className="btn ghost sm" onClick={() => { setFrom(isoDaysAgo(90)); setTo(today) }}>3 hónap</button>
          <button className="btn ghost sm" onClick={() => { setFrom(isoDaysAgo(365)); setTo(today) }}>1 év</button>
          <button className="btn ghost sm" onClick={() => { setFrom(isoDaysAgo(365 * 3)); setTo(today) }}>3 év</button>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select className="select" style={{ width: 'auto', minHeight: 40, padding: '6px 10px' }} value={filterCar} onChange={(e) => setFilterCar(e.target.value)}>
            <option value="">🚚 Minden autó</option>
            {(data?.cars ?? []).map((c) => {
              const cat = (c.category as unknown as { name: string } | null)?.name
              return <option key={c.id} value={c.id}>{cat ? `${cat} · ` : ''}{c.plate}</option>
            })}
          </select>
          <select className="select" style={{ width: 'auto', minHeight: 40, padding: '6px 10px' }} value={filterPerson} onChange={(e) => setFilterPerson(e.target.value)}>
            <option value="">👤 Minden munkatárs</option>
            {(view?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="select" style={{ width: 'auto', minHeight: 40, padding: '6px 10px' }} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">📋 Minden típus</option>
            <option value="usage">🚚 Autóhasználat</option>
            <option value="switch">🔁 Autócserék</option>
            <option value="incident">⚠️ Események / balesetek</option>
            <option value="issue">🔧 Autó-hibák</option>
          </select>
          {(filterCar || filterPerson || filterType) && (
            <button className="btn ghost sm" onClick={() => { setFilterCar(''); setFilterPerson(''); setFilterType('') }}>✕ Szűrők törlése</button>
          )}
        </div>
      </div>

      {isError && <div className="alert error">Az előzmények betöltése nem sikerült. Frissítsd az oldalt.</div>}
      {isLoading && <div className="card"><div className="spinner" /></div>}

      {view && (
        <div className="card stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="badge">{view.stats.dayCount} munkanap</span>
            <span className="badge primary">🔁 {view.stats.switchCount} autócsere</span>
            <span className="badge warning">⚠️ {view.stats.incidentCount} esemény</span>
            <span className="badge">🔧 {view.stats.issueCount} hiba</span>
          </div>
          {view.stats.reasons.length > 0 && (
            <div className="tiny muted">
              Cserék okai: {view.stats.reasons.map(([r, n]) => `${r} — ${n} db`).join(' · ')}
            </div>
          )}
        </div>
      )}

      {view && view.days.length === 0 && !isLoading && (
        <div className="empty"><span className="ico">🕓</span>Nincs adat a kiválasztott időszakban / szűrőkkel.</div>
      )}

      {view?.days.map((g) => {
        const hasContent =
          (show('usage') && g.usage.length > 0) ||
          (show('switch') && g.switches.length > 0) ||
          (show('incident') && g.incidents.length > 0) ||
          (show('issue') && g.issues.length > 0)
        if (!hasContent) return null
        return (
          <div key={g.date} className="card stack" style={{ gap: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>
              {formatDate(g.date)}
              <span className="tiny muted" style={{ fontWeight: 400 }}>
                {' '}· {new Date(`${g.date}T12:00:00`).toLocaleDateString('hu-HU', { weekday: 'long' })}
              </span>
            </div>

            {show('usage') && g.usage.map((u) => (
              <div key={u.carId} className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="small" style={{ fontWeight: 700, minWidth: 76 }}>
                  {catOf.get(u.carId) && <span className="tiny muted" style={{ fontWeight: 400 }}>{catOf.get(u.carId)} · </span>}
                  🚚 {u.plate}
                </span>
                <span className="small muted">
                  {u.segments.map((sg, i) => (
                    <span key={i}>{i > 0 && ' · '}{sg.who} ({t(sg.from)}–{sg.to ? t(sg.to) : '…'})</span>
                  ))}
                </span>
              </div>
            ))}

            {show('switch') && g.timelines.map((tl) => (
              <div key={tl.userId} className="stack" style={{ gap: 2, borderLeft: '3px solid var(--warning)', paddingLeft: 10 }}>
                <span className="tiny" style={{ fontWeight: 700 }}>🔁 Autócsere — {tl.who}</span>
                <CarTimeline entries={tl.entries} />
              </div>
            ))}

            {show('incident') && g.incidents.map((i) => (
              <div key={i.id} className="stack" style={{ gap: 2, borderLeft: '3px solid var(--danger)', paddingLeft: 10 }}>
                <span className="tiny" style={{ fontWeight: 700 }}>
                  ⚠️ Esemény / baleset — {nm(i.user_id)}{i.car_id ? ` · ${carLabel(i.car_id)}` : ''} · {t(i.created_at)}
                </span>
                <span className="small">{i.note || '(nincs leírás)'}</span>
              </div>
            ))}

            {show('issue') && g.issues.map((i) => (
              <div key={i.id} className="stack" style={{ gap: 2, borderLeft: '3px solid var(--border)', paddingLeft: 10 }}>
                <span className="tiny" style={{ fontWeight: 700 }}>
                  🔧 Autó-hiba — {carLabel(i.car_id)} · {nm(i.user_id)} · {formatDateTime(i.created_at)} · {carIssueStatusLabel[i.status] ?? i.status}
                </span>
                <span className="small">{i.note || '(nincs leírás)'}</span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
