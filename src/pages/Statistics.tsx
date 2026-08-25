import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useWorkspace } from '../context/WorkspaceContext'
import { resolveNames } from '../lib/names'
import { formatHuf, formatHours, todayISO } from '../lib/labels'
import { exportRowsToXlsx } from '../lib/export'

type PresetKey = 'this-month' | 'prev-month' | 'm3' | 'm6' | 'ytd' | 'm12'

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'this-month', label: 'Ez a hónap' },
  { key: 'prev-month', label: 'Előző hónap' },
  { key: 'm3', label: 'Utolsó 3 hónap' },
  { key: 'm6', label: 'Utolsó 6 hónap' },
  { key: 'ytd', label: 'Idén (jan. 1-től)' },
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
  hoursMs: number
  daysWithHours: number
  tips: number
  shortfall: number
  stops: number
  skippedStops: number
  incidents: number
  switches: number
  issues: number
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
  fuelCost: number
  liters: number
  avgConsumption: number | null
}

export default function Statistics() {
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const [preset, setPreset] = useState<PresetKey>('m3')
  const range = useMemo(() => presetRange(preset), [preset])

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: ['statistics', currentWorkspaceId, preset, range.start],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const ws = currentWorkspaceId!
      // Lapozva (1000 sor felett is teljes), hibánál dob — csonka statisztika ne szülessen
      const [carsRes, checkins, shifts, stops, fuel, incidents, issues, adj, swaps] = await Promise.all([
        supabase.from('cars').select('id, plate, category:car_categories(name)').eq('workspace_id', ws),
        fetchAll((f, t) => supabase.from('check_ins')
          .select('user_id, car_id, work_date, checked_in_at, checked_out_at, switch_reason, prev_car_id, outside_geofence, out_outside_geofence')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('shifts').select('driver_id, loader_id, work_date')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('route_stops').select('recorded_by, tip, status')
          .eq('workspace_id', ws).gte('recorded_at', range.startISO).lt('recorded_at', range.endISO).order('id').range(f, t)),
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
      ])
      if (carsRes.error) throw carsRes.error
      const cars = (carsRes.data ?? []) as unknown as { id: string; plate: string; category: { name: string } | null }[]

      const users = new Map<string, UserStat>()
      const u = (id: string): UserStat => {
        if (!users.has(id)) {
          users.set(id, {
            id, name: '', days: 0, driverDays: 0, loaderDays: 0, hoursMs: 0, daysWithHours: 0,
            tips: 0, shortfall: 0, stops: 0, skippedStops: 0, incidents: 0, switches: 0,
            issues: 0, outside: 0, assignedDays: 0, missedDays: 0, advances: 0, swapRequests: 0,
          })
        }
        return users.get(id)!
      }

      // Napi szerep a beosztásból (beosztás nélküli nap = rakodó, mint a bérszámításban)
      const roleByUserDay = new Map<string, 'driver' | 'loader'>()
      for (const s of shifts ?? []) {
        if (s.driver_id) roleByUserDay.set(`${s.driver_id}|${s.work_date}`, 'driver')
        if (s.loader_id) roleByUserDay.set(`${s.loader_id}|${s.work_date}`, 'loader')
      }

      // Becsekkolások: napok, órák, cserék, geofence; autónként használat
      const seenDay = new Set<string>()
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
          if ((roleByUserDay.get(key) ?? 'loader') === 'driver') row.driverDays++
          else row.loaderDays++
        }
        const row = u(c.user_id)
        if (c.checked_out_at) {
          row.hoursMs += new Date(c.checked_out_at).getTime() - new Date(c.checked_in_at).getTime()
          row.daysWithHours++
        }
        if (c.switch_reason) row.switches++
        if (c.outside_geofence || c.out_outside_geofence) row.outside++
        if (c.prev_car_id) switchedAwayByCar.set(c.prev_car_id, (switchedAwayByCar.get(c.prev_car_id) ?? 0) + 1)
        if (!carDays.has(c.car_id)) carDays.set(c.car_id, new Set())
        carDays.get(c.car_id)!.add(c.work_date)
      }

      // Beosztott vs ledolgozott (csak múltbeli napokra — a jövő nem "kihagyás")
      const today = todayISO()
      for (const s of shifts ?? []) {
        for (const id of [s.driver_id, s.loader_id]) {
          if (!id) continue
          const row = u(id)
          row.assignedDays++
          if (s.work_date < today && !checkinDays.has(`${id}|${s.work_date}`)) row.missedDays++
        }
      }

      for (const s of stops ?? []) {
        if (!s.recorded_by) continue
        const row = u(s.recorded_by)
        row.stops++
        if (s.status === 'skipped') row.skippedStops++
        const tip = Number(s.tip ?? 0)
        if (tip > 0) row.tips += tip
        if (tip < 0) row.shortfall += -tip
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
          fuelCost: logs.reduce((a, f) => a + Number(f.amount ?? 0), 0),
          liters: logs.reduce((a, f) => a + Number(f.liters ?? 0), 0),
          avgConsumption: cons.length ? Math.round((cons.reduce((a, b) => a + b, 0) / cons.length) * 100) / 100 : null,
        }
      }).filter((c) => c.daysUsed > 0 || c.issues > 0 || c.fuelCost > 0)
        .sort((a, b) => b.daysUsed - a.daysUsed || a.plate.localeCompare(b.plate))

      const userRows = [...users.values()].filter((r) => r.days > 0 || r.assignedDays > 0)
        .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name))

      return { userRows, carRows }
    },
  })

  async function exportXlsx() {
    if (!data) return
    await exportRowsToXlsx(`statisztika_${range.start}_${range.endExclusive}.xlsx`, 'Statisztika', data.userRows.map((r) => ({
      'Munkatárs': r.name, 'Napok': r.days, 'Sofőr nap': r.driverDays, 'Rakodó nap': r.loaderDays,
      'Órák': Math.round((r.hoursMs / 3600000) * 10) / 10,
      'Borravaló': r.tips, 'Borravaló/nap': r.days ? Math.round(r.tips / r.days) : 0,
      'Kp-hiány': r.shortfall, 'Stopok': r.stops, 'Kihagyott stop': r.skippedStops,
      'Esemény': r.incidents, 'Autócsere': r.switches, 'Hibabejelentés': r.issues,
      'Telephelyen kívül': r.outside, 'Kihagyott beosztás': r.missedDays,
      'Előleg': r.advances, 'Cserekérés': r.swapRequests,
    })))
  }

  // Kiemelések az időszakra
  const highlights = useMemo(() => {
    if (!data || data.userRows.length === 0) return null
    const withDays = data.userRows.filter((r) => r.days > 0)
    const mostDays = withDays[0] ?? null
    const tipsEligible = withDays.filter((r) => r.days >= 3)
    const bestTips = tipsEligible.length
      ? [...tipsEligible].sort((a, b) => b.tips / b.days - a.tips / a.days)[0]
      : null
    const mostIncidents = [...withDays].sort((a, b) => b.incidents - a.incidents)[0]
    const problemCar = data.carRows.length
      ? [...data.carRows].sort((a, b) => (b.issues + b.switchedAway) - (a.issues + a.switchedAway))[0]
      : null
    return {
      mostDays,
      bestTips,
      mostIncidents: mostIncidents && mostIncidents.incidents > 0 ? mostIncidents : null,
      problemCar: problemCar && problemCar.issues + problemCar.switchedAway > 0 ? problemCar : null,
    }
  }, [data])

  const totals = useMemo(() => {
    if (!data) return null
    return {
      days: data.userRows.reduce((s, r) => s + r.days, 0),
      tips: data.userRows.reduce((s, r) => s + r.tips, 0),
      incidents: data.userRows.reduce((s, r) => s + r.incidents, 0),
      fuel: data.carRows.reduce((s, c) => s + c.fuelCost, 0),
    }
  }, [data])

  return (
    <div className="stack">
      <h2>Statisztika — {currentWorkspace?.name}</h2>

      <div className="card stack">
        <div className="field">
          <label>Időszak</label>
          <select className="select" value={preset} onChange={(e) => setPreset(e.target.value as PresetKey)}>
            {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
        <div className="tiny muted">{range.start} – {range.endExclusive} (a záró nap nélkül)</div>
        <button className="btn secondary sm" disabled={!data || data.userRows.length === 0} onClick={() => void exportXlsx()}>📊 Export Excel</button>
      </div>

      {isLoading && <div className="card"><div className="spinner" /></div>}
      {isError && (
        <div className="alert error">
          A statisztika betöltése nem sikerült{loadError instanceof Error ? `: ${loadError.message}` : ''}. Frissítsd az oldalt.
        </div>
      )}

      {totals && (totals.days > 0 || totals.fuel > 0) && (
        <div className="card">
          <div className="card-title">Összesen az időszakban</div>
          <div className="grid-2 small">
            <div className="between"><span className="muted">Munkanap (fő×nap)</span><span style={{ fontWeight: 700 }}>{totals.days}</span></div>
            <div className="between"><span className="muted">Borravaló</span><span style={{ fontWeight: 700, color: 'var(--success)' }}>{formatHuf(totals.tips)}</span></div>
            <div className="between"><span className="muted">Esemény / baleset</span><span style={{ fontWeight: 700, color: totals.incidents > 0 ? 'var(--warning)' : 'inherit' }}>{totals.incidents}</span></div>
            <div className="between"><span className="muted">Üzemanyag</span><span style={{ fontWeight: 700 }}>{formatHuf(totals.fuel)}</span></div>
          </div>
        </div>
      )}

      {highlights && (
        <div className="card stack" style={{ gap: 6 }}>
          <div className="card-title">🏆 Kiemelések</div>
          {highlights.mostDays && (
            <div className="between small">
              <span className="muted">Legtöbbet dolgozott</span>
              <span>{highlights.mostDays.name} · {highlights.mostDays.days} nap</span>
            </div>
          )}
          {highlights.bestTips && (
            <div className="between small">
              <span className="muted">Legjobb borravaló-átlag</span>
              <span style={{ color: 'var(--success)' }}>
                {highlights.bestTips.name} · {formatHuf(Math.round(highlights.bestTips.tips / highlights.bestTips.days))}/nap
              </span>
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
          <div className="card-title">👥 Munkatársak</div>
          {data.userRows.map((r) => (
            <div key={r.id} className="stack" style={{ gap: 4 }}>
              <div style={{ fontWeight: 700 }}>{r.name}</div>
              <div className="grid-2 small">
                <div className="between"><span className="muted">Napok</span><span>{r.days} ({r.driverDays} sofőr / {r.loaderDays} rakodó)</span></div>
                <div className="between">
                  <span className="muted">Átlag munkaidő</span>
                  <span>{r.daysWithHours > 0 ? `${formatHours(r.hoursMs / r.daysWithHours)}/nap` : '—'}</span>
                </div>
                <div className="between">
                  <span className="muted">Borravaló</span>
                  <span style={{ color: 'var(--success)' }}>
                    {formatHuf(r.tips)}{r.days > 0 && r.tips > 0 ? ` (${formatHuf(Math.round(r.tips / r.days))}/nap)` : ''}
                  </span>
                </div>
                <div className="between">
                  <span className="muted">Stopok</span>
                  <span>{r.stops}{r.days > 0 && r.stops > 0 ? ` (${Math.round((r.stops / r.days) * 10) / 10}/nap)` : ''}</span>
                </div>
                <div className="between">
                  <span className="muted">Esemény / baleset</span>
                  <span style={{ color: r.incidents > 0 ? 'var(--warning)' : 'inherit' }}>
                    {r.incidents}{r.incidents > 0 && r.days > 0 ? ` (≈1 / ${Math.round(r.days / r.incidents)} nap)` : ''}
                  </span>
                </div>
                {r.shortfall > 0 && (
                  <div className="between"><span className="muted">Kp-hiány</span><span style={{ color: 'var(--danger)' }}>{formatHuf(r.shortfall)}</span></div>
                )}
                {r.skippedStops > 0 && (
                  <div className="between"><span className="muted">Kihagyott stop</span><span style={{ color: 'var(--warning)' }}>{r.skippedStops}</span></div>
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
          <div className="card-title">🚗 Autók</div>
          {data.carRows.map((c) => (
            <div key={c.id} className="stack" style={{ gap: 4 }}>
              <div style={{ fontWeight: 700 }}>
                {c.plate}{c.category ? <span className="muted" style={{ fontWeight: 400 }}> · {c.category}</span> : null}
              </div>
              <div className="grid-2 small">
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
        <div className="empty"><span className="ico">🎯</span>Nincs adat ebben az időszakban.</div>
      )}
    </div>
  )
}
