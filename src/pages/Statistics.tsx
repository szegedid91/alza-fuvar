import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useWorkspace } from '../context/WorkspaceContext'
import { resolveNames } from '../lib/names'
import { formatHuf, formatHours, todayISO, formatDate } from '../lib/labels'
import { addDays } from '../lib/calendar'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'
import { exportRowsToXlsx } from '../lib/export'

type PresetKey = 'this-month' | 'prev-month' | 'm3' | 'm6' | 'ytd' | 'm12'

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'this-month', label: 'Ez a hónap' },
  { key: 'prev-month', label: 'Előző hónap' },
  { key: 'm3', label: 'Utolsó 3 hónap' },
  { key: 'm6', label: 'Utolsó 6 hónap' },
  { key: 'ytd', label: 'Idén (jan. 1-jétől)' },
  { key: 'm12', label: 'Utolsó 12 hónap' },
]

// Helyi naptári nap ISO formában — nem UTC!
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Időszak a preset alapján: [start, endExclusive) dátumok + timestamptz-határok
function presetRange(key: PresetKey) {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const first = (yy: number, mm: number) => new Date(yy, mm, 1)
  const endEx = first(y, m + 1) // a folyó hónap vége (exkluzív) minden presetnél
  let start: Date
  switch (key) {
    case 'this-month': start = first(y, m); break
    case 'prev-month': start = first(y, m - 1); break
    case 'm3': start = first(y, m - 2); break
    case 'm6': start = first(y, m - 5); break
    case 'ytd': start = first(y, 0); break
    case 'm12': start = first(y, m - 11); break
  }
  const endExclusive = key === 'prev-month' ? first(y, m) : endEx
  return {
    start: localISO(start),
    endExclusive: localISO(endExclusive),
    startISO: start.toISOString(),
    endISO: endExclusive.toISOString(),
  }
}

interface UserStat {
  id: string
  name: string
  days: number
  driverDays: number
  loaderDays: number
  traineeDays: number
  hoursMs: number
  daysWithHours: number
  incidents: number
  switches: number
  issues: number
  inspections: number
  cleanings: number
  outside: number
  assignedDays: number
  missedDays: number
  advances: number
  swapRequests: number
}

interface CarStat {
  id: string
  plate: string
  category: string | null
  daysUsed: number
  issues: number
  incidents: number
  switchedAway: number
  inspections: number
  cleanings: number
  fuelCost: number
  liters: number
  avgConsumption: number | null
}

export default function Statistics() {
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const [preset, setPreset] = useState<PresetKey>('m3')
  const range = useMemo(() => presetRange(preset), [preset])

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: ['statistics', currentWorkspaceId, preset, range.start, 'v2'],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const ws = currentWorkspaceId!
      // Lapozva (1000 sor felett is teljes), hibánál dob — csonka statisztika ne szülessen
      const [carsRes, checkins, shifts, fuel, incidents, issues, adj, swaps, insp, clean] = await Promise.all([
        supabase.from('cars').select('id, plate, category:car_categories(name)').eq('workspace_id', ws),
        fetchAll((f, t) => supabase.from('check_ins')
          .select('user_id, car_id, work_date, checked_in_at, checked_out_at, switch_reason, prev_car_id, outside_geofence, out_outside_geofence')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('shifts').select('driver_id, loader_id, trainee_id, work_date')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('fuel_logs').select('car_id, liters, amount, consumption')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('incidents').select('user_id, car_id, work_date')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('car_issues').select('user_id, car_id, created_at')
          .eq('workspace_id', ws).gte('created_at', range.startISO).lt('created_at', range.endISO).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('adjustments').select('user_id, type, amount')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('swap_requests').select('requested_by')
          .eq('workspace_id', ws).gte('created_at', range.startISO).lt('created_at', range.endISO).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('car_inspections').select('user_id, car_id')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('cleanings').select('user_id, car_id')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
      ])
      if (carsRes.error) throw carsRes.error
      const cars = (carsRes.data ?? []) as unknown as { id: string; plate: string; category: { name: string } | null }[]

      const users = new Map<string, UserStat>()
      const u = (id: string): UserStat => {
        if (!users.has(id)) {
          users.set(id, {
            id, name: '', days: 0, driverDays: 0, loaderDays: 0, traineeDays: 0, hoursMs: 0, daysWithHours: 0,
            incidents: 0, switches: 0,
            issues: 0, inspections: 0, cleanings: 0, outside: 0, assignedDays: 0, missedDays: 0, advances: 0, swapRequests: 0,
          })
        }
        return users.get(id)!
      }

      // Napi szerep a beosztásból (beosztás nélküli nap = rakodó, mint a bérszámításban)
      const roleByUserDay = new Map<string, 'driver' | 'loader' | 'trainee'>()
      for (const s of shifts ?? []) {
        if (s.trainee_id && !roleByUserDay.has(`${s.trainee_id}|${s.work_date}`)) roleByUserDay.set(`${s.trainee_id}|${s.work_date}`, 'trainee')
        if (s.loader_id && roleByUserDay.get(`${s.loader_id}|${s.work_date}`) !== 'driver') roleByUserDay.set(`${s.loader_id}|${s.work_date}`, 'loader')
        if (s.driver_id) roleByUserDay.set(`${s.driver_id}|${s.work_date}`, 'driver')
      }

      // Becsekkolások: napok, órák, cserék, geofence; autónként használat
      const seenDay = new Set<string>()
      // Napi munkaidő: napközbeni autócserénél TÖBB check_ins sor van egy napra
      // (A→B→A esetén az elsőt újranyitjuk), ezért soronként összeadva duplázna.
      // A nap hossza = utolsó kijelentkezés − első becsekkolás.
      // open = aznap van még NYITOTT becsekkolása (autócsere után is): a nap
      // nem tekinthető lezártnak, különben a részleges idő rontaná az átlagot
      const dayspan = new Map<string, { from: number; to: number | null; open: boolean }>()
      const checkinDays = new Set<string>() // `${userId}|${date}` — a kihagyott beosztáshoz
      const carDays = new Map<string, Set<string>>()
      const switchedAwayByCar = new Map<string, number>()
      for (const c of checkins ?? []) {
        const key = `${c.user_id}|${c.work_date}`
        checkinDays.add(key)
        if (!seenDay.has(key)) {
          seenDay.add(key)
          const row = u(c.user_id)
          row.days++
          const daily = roleByUserDay.get(key) ?? 'loader'
          if (daily === 'driver') row.driverDays++
          else if (daily === 'trainee') row.traineeDays++
          else row.loaderDays++
        }
        const row = u(c.user_id)
        const from = new Date(c.checked_in_at).getTime()
        const to = c.checked_out_at ? new Date(c.checked_out_at).getTime() : null
        const span = dayspan.get(key)
        if (!span) dayspan.set(key, { from, to, open: to == null })
        else {
          span.from = Math.min(span.from, from)
          span.to = to == null ? span.to : span.to == null ? to : Math.max(span.to, to)
          if (to == null) span.open = true
        }
        if (c.switch_reason) row.switches++
        if (c.outside_geofence || c.out_outside_geofence) row.outside++
        if (c.prev_car_id) switchedAwayByCar.set(c.prev_car_id, (switchedAwayByCar.get(c.prev_car_id) ?? 0) + 1)
        if (!carDays.has(c.car_id)) carDays.set(c.car_id, new Set())
        carDays.get(c.car_id)!.add(c.work_date)
      }

      // Napi munkaidő összegzése (naponként egyszer, a nap teljes hosszával)
      for (const [key, span] of dayspan) {
        if (span.open || span.to == null) continue // még nem jelentkezett ki — nincs lezárt nap
        const row = u(key.slice(0, key.indexOf('|')))
        row.hoursMs += Math.max(0, span.to - span.from)
        row.daysWithHours++
      }

      // Beosztott vs ledolgozott (csak múltbeli napokra — a jövő nem "kihagyás").
      // NAPRA deduplikálva: aki egy napon két autóra is be van osztva, annak is
      // egy nap az egy nap (különben duplán számolna hiányzást).
      const today = todayISO()
      const assignedDay = new Set<string>()
      for (const s of shifts ?? []) {
        for (const id of [s.driver_id, s.loader_id, s.trainee_id]) {
          if (!id) continue
          const k = `${id}|${s.work_date}`
          if (assignedDay.has(k)) continue
          assignedDay.add(k)
          const row = u(id)
          row.assignedDays++
          if (s.work_date < today && !checkinDays.has(k)) row.missedDays++
        }
      }

      const incidentsByCar = new Map<string, number>()
      for (const i of incidents ?? []) {
        if (i.user_id) u(i.user_id).incidents++
        if (i.car_id) incidentsByCar.set(i.car_id, (incidentsByCar.get(i.car_id) ?? 0) + 1)
      }
      const issuesByCar = new Map<string, number>()
      for (const i of issues ?? []) {
        if (i.user_id) u(i.user_id).issues++
        if (i.car_id) issuesByCar.set(i.car_id, (issuesByCar.get(i.car_id) ?? 0) + 1)
      }
      // Karbantartás: ellenőrző fotók és takarítások fejenként + autónként
      const inspByCar = new Map<string, number>()
      const cleanByCar = new Map<string, number>()
      for (const i of insp ?? []) { u(i.user_id).inspections++; inspByCar.set(i.car_id, (inspByCar.get(i.car_id) ?? 0) + 1) }
      for (const c of clean ?? []) { u(c.user_id).cleanings++; cleanByCar.set(c.car_id, (cleanByCar.get(c.car_id) ?? 0) + 1) }
      for (const a of adj ?? []) {
        if (a.type === 'advance') u(a.user_id).advances += Number(a.amount)
      }
      for (const s of swaps ?? []) {
        if (s.requested_by) u(s.requested_by).swapRequests++
      }

      const names = await resolveNames([...users.keys()])
      for (const row of users.values()) row.name = names[row.id] ?? '—'

      const carRows: CarStat[] = cars.map((c) => {
        const logs = (fuel ?? []).filter((f) => f.car_id === c.id)
        const cons = logs.map((f) => Number(f.consumption)).filter((n) => n > 0)
        return {
          id: c.id, plate: c.plate, category: c.category?.name ?? null,
          daysUsed: carDays.get(c.id)?.size ?? 0,
          issues: issuesByCar.get(c.id) ?? 0,
          incidents: incidentsByCar.get(c.id) ?? 0,
          switchedAway: switchedAwayByCar.get(c.id) ?? 0,
          inspections: inspByCar.get(c.id) ?? 0,
          cleanings: cleanByCar.get(c.id) ?? 0,
          fuelCost: logs.reduce((a, f) => a + Number(f.amount ?? 0), 0),
          liters: logs.reduce((a, f) => a + Number(f.liters ?? 0), 0),
          avgConsumption: cons.length ? Math.round((cons.reduce((a, b) => a + b, 0) / cons.length) * 100) / 100 : null,
        }
      }).filter((c) => c.daysUsed > 0 || c.issues > 0 || c.fuelCost > 0 || c.inspections + c.cleanings > 0)
        .sort((a, b) => b.daysUsed - a.daysUsed || a.plate.localeCompare(b.plate))

      // Aki bármilyen nyomot hagyott az időszakban (nap, beosztás, esemény,
      // hiba, előleg), az látszik — különben az összesítők nem stimmelnének
      const userRows = [...users.values()].filter(
        (r) => r.days > 0 || r.assignedDays > 0 || r.incidents > 0 || r.issues > 0 || r.advances > 0 || r.inspections + r.cleanings > 0,
      )
        .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name))

      return { userRows, carRows }
    },
  })

  async function exportXlsx() {
    if (!data) return
    await exportRowsToXlsx(`statisztika_${range.start}_${range.endExclusive}.xlsx`, 'Statisztika', data.userRows.map((r) => ({
      'Munkatárs': r.name, 'Napok': r.days, 'Sofőr nap': r.driverDays, 'Rakodó nap': r.loaderDays, 'Betanuló nap': r.traineeDays,
      'Órák': Math.round((r.hoursMs / 3600000) * 10) / 10,
      'Esemény': r.incidents, 'Autócsere': r.switches, 'Hibabejelentés': r.issues,
      'Ellenőrzés': r.inspections, 'Takarítás': r.cleanings,
      'Telephelyen kívül': r.outside, 'Kihagyott beosztás': r.missedDays,
      'Előleg': r.advances, 'Cserekérés': r.swapRequests,
    })))
  }

  // Kiemelések az időszakra
  const highlights = useMemo(() => {
    if (!data || data.userRows.length === 0) return null
    const withDays = data.userRows.filter((r) => r.days > 0)
    const mostDays = withDays[0] ?? null
    const mostIncidents = [...withDays].sort((a, b) => b.incidents - a.incidents)[0]
    const mostCare = [...data.userRows].sort((a, b) => (b.inspections + b.cleanings) - (a.inspections + a.cleanings))[0]
    const problemCar = data.carRows.length
      ? [...data.carRows].sort((a, b) => (b.issues + b.switchedAway) - (a.issues + a.switchedAway))[0]
      : null
    return {
      mostDays,
      mostIncidents: mostIncidents && mostIncidents.incidents > 0 ? mostIncidents : null,
      mostCare: mostCare && mostCare.inspections + mostCare.cleanings > 0 ? mostCare : null,
      problemCar: problemCar && problemCar.issues + problemCar.switchedAway > 0 ? problemCar : null,
    }
  }, [data])

  const totals = useMemo(() => {
    if (!data) return null
    return {
      days: data.userRows.reduce((s, r) => s + r.days, 0),
      issues: data.userRows.reduce((s, r) => s + r.issues, 0),
      incidents: data.userRows.reduce((s, r) => s + r.incidents, 0),
      fuel: data.carRows.reduce((s, c) => s + c.fuelCost, 0),
    }
  }, [data])

  return (
    <div className="stack">
      <h2>Statisztika — {currentWorkspace?.name}</h2>

      <div className="card stack primary">
        <div className="card-title" style={{ margin: 0 }}><Icon name="target" />Időszak</div>
        {/* Időszak-chipek: egy koppintás, a kiválasztott kiemelve */}
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" className={`badge ${preset === p.key ? 'primary' : ''}`}
              style={{ cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700, minHeight: 36, padding: '6px 12px' }}
              onClick={() => setPreset(p.key)}>{p.label}</button>
          ))}
        </div>
        <div className="tiny muted">{formatDate(range.start)} – {formatDate(addDays(range.endExclusive, -1))}</div>
        {totals && (totals.days > 0 || totals.fuel > 0) && (
          <div className="grid-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div><div className="tiny muted">Munkanap (fő×nap)</div><div className="num num-lg">{totals.days}</div></div>
            <div><div className="tiny muted">Hibabejelentés</div><div className="num num-lg" style={{ color: totals.issues > 0 ? 'var(--warning)' : undefined }}>{totals.issues}</div></div>
            <div><div className="tiny muted">Esemény / baleset</div><div className="num num-lg" style={{ color: totals.incidents > 0 ? 'var(--warning)' : undefined }}>{totals.incidents}</div></div>
            <div><div className="tiny muted">Üzemanyag</div><div className="num num-lg">{formatHuf(totals.fuel)}</div></div>
          </div>
        )}
        <button className="btn secondary sm" disabled={!data || data.userRows.length === 0} onClick={() => void exportXlsx()}><Icon name="file-text" />Exportálás Excelbe</button>
      </div>

      {isLoading && <><Skeleton rows={3} /><Skeleton rows={4} /></>}
      {isError && (
        <div className="alert error">
          A statisztika betöltése nem sikerült{loadError instanceof Error ? `: ${loadError.message}` : ''}. Frissítsd az oldalt.
        </div>
      )}

      {highlights && (
        <div className="card stack" style={{ gap: 6 }}>
          <div className="card-title"><Icon name="star" />Kiemelések</div>
          {highlights.mostDays && (
            <div className="between small">
              <span className="muted">Legtöbbet dolgozott</span>
              <span>{highlights.mostDays.name} · {highlights.mostDays.days} nap</span>
            </div>
          )}
          {highlights.mostCare && (
            <div className="between small">
              <span className="muted">Legtöbb ellenőrzés + takarítás</span>
              <span style={{ color: 'var(--success)' }}>{highlights.mostCare.name} · {highlights.mostCare.inspections + highlights.mostCare.cleanings} db</span>
            </div>
          )}
          {highlights.mostIncidents && (
            <div className="between small">
              <span className="muted">Legtöbb esemény</span>
              <span style={{ color: 'var(--warning)' }}>{highlights.mostIncidents.name} · {highlights.mostIncidents.incidents} db</span>
            </div>
          )}
          {highlights.problemCar && (
            <div className="between small">
              <span className="muted">Legproblémásabb autó</span>
              <span style={{ color: 'var(--danger)' }}>
                {highlights.problemCar.plate} · {highlights.problemCar.issues} hiba, {highlights.problemCar.switchedAway} csere miatta
              </span>
            </div>
          )}
        </div>
      )}

      {data && data.userRows.length > 0 && (
        <div className="card stack">
          <div className="card-title"><Icon name="users" />Munkatársak</div>
          {data.userRows.map((r) => (
            <div key={r.id} className="stack" style={{ gap: 4 }}>
              <div className="between">
                <div style={{ fontWeight: 700 }}>{r.name}</div>
                <span className={`badge ${r.days > 0 ? 'primary' : ''}`}>{r.days} nap</span>
              </div>
              <div className="grid-2 pay-grid small">
                <div className="between"><span className="muted">Szerep</span><span>{r.driverDays} sofőr / {r.loaderDays} rakodó{r.traineeDays > 0 ? ` / ${r.traineeDays} betanuló` : ''}</span></div>
                <div className="between">
                  <span className="muted">Átlag munkaidő</span>
                  <span>{r.daysWithHours > 0 ? `${formatHours(Math.round(r.hoursMs / r.daysWithHours))}/nap` : '—'}</span>
                </div>
                <div className="between">
                  <span className="muted">Esemény / baleset</span>
                  <span style={{ color: r.incidents > 0 ? 'var(--warning)' : 'inherit' }}>
                    {r.incidents}{r.incidents > 0 && r.days > 0 ? ` (≈1 / ${Math.round(r.days / r.incidents)} nap)` : ''}
                  </span>
                </div>
                {r.inspections + r.cleanings > 0 && (
                  <div className="between"><span className="muted">Ellenőrzés / takarítás</span><span>{r.inspections} / {r.cleanings}</span></div>
                )}
                {r.switches > 0 && (
                  <div className="between"><span className="muted">Autócsere menet közben</span><span>{r.switches}</span></div>
                )}
                {r.issues > 0 && (
                  <div className="between"><span className="muted">Hibabejelentés</span><span>{r.issues}</span></div>
                )}
                {r.outside > 0 && (
                  <div className="between"><span className="muted">Telephelyen kívüli be/ki</span><span style={{ color: 'var(--warning)' }}>{r.outside}</span></div>
                )}
                {r.missedDays > 0 && (
                  <div className="between"><span className="muted">Beosztva, de nem jött</span><span style={{ color: 'var(--danger)' }}>{r.missedDays} nap</span></div>
                )}
                {r.advances > 0 && (
                  <div className="between"><span className="muted">Előleg</span><span style={{ color: 'var(--warning)' }}>{formatHuf(r.advances)}</span></div>
                )}
                {r.swapRequests > 0 && (
                  <div className="between"><span className="muted">Cserekérés</span><span>{r.swapRequests}</span></div>
                )}
              </div>
              <div className="divider" />
            </div>
          ))}
        </div>
      )}

      {data && data.carRows.length > 0 && (
        <div className="card stack">
          <div className="card-title"><Icon name="truck" />Autók</div>
          {data.carRows.map((c) => (
            <div key={c.id} className="stack" style={{ gap: 4 }}>
              <div className="num" style={{ fontSize: 16 }}>
                {c.plate}{c.category ? <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}> · {c.category}</span> : null}
              </div>
              <div className="grid-2 pay-grid small">
                <div className="between"><span className="muted">Használatban</span><span>{c.daysUsed} nap</span></div>
                <div className="between">
                  <span className="muted">Üzemanyag</span>
                  <span>{formatHuf(c.fuelCost)}{c.daysUsed > 0 && c.fuelCost > 0 ? ` (${formatHuf(Math.round(c.fuelCost / c.daysUsed))}/nap)` : ''}</span>
                </div>
                <div className="between">
                  <span className="muted">Átlagfogyasztás</span>
                  <span>{c.avgConsumption != null ? `${c.avgConsumption} l/100km` : '—'}</span>
                </div>
                <div className="between">
                  <span className="muted">Hibabejelentés</span>
                  <span style={{ color: c.issues > 0 ? 'var(--warning)' : 'inherit' }}>{c.issues}</span>
                </div>
                {c.inspections + c.cleanings > 0 && (
                  <div className="between"><span className="muted">Ellenőrzés / takarítás</span><span>{c.inspections} / {c.cleanings}</span></div>
                )}
                {c.switchedAway > 0 && (
                  <div className="between"><span className="muted">Lecserélték menet közben</span><span style={{ color: 'var(--danger)' }}>{c.switchedAway}×</span></div>
                )}
                {c.incidents > 0 && (
                  <div className="between"><span className="muted">Esemény az autóval</span><span style={{ color: 'var(--warning)' }}>{c.incidents}</span></div>
                )}
              </div>
              <div className="divider" />
            </div>
          ))}
        </div>
      )}

      {data && data.userRows.length === 0 && data.carRows.length === 0 && (
        <div className="empty"><span className="ico"><Icon name="target" size={40} /></span>Nincs adat ebben az időszakban.</div>
      )}
    </div>
  )
}
