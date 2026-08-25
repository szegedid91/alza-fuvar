import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useWorkspace } from '../context/WorkspaceContext'
import { monthRange, currentYm } from '../lib/payroll'
import { resolveNames } from '../lib/names'
import { formatHuf, formatHours } from '../lib/labels'
import { exportRowsToXlsx } from '../lib/export'

interface UserRow {
  id: string; name: string; days: number; hoursMs: number
  driverDays: number; loaderDays: number; stops: number; tips: number; shortfall: number
}
interface CarRow {
  id: string; plate: string; fuelCount: number; liters: number; cost: number
  avgConsumption: number | null; kmDriven: number | null
}

export default function Reports() {
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const [ym, setYm] = useState(currentYm())
  const range = useMemo(() => monthRange(ym), [ym])

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: ['reports', currentWorkspaceId, ym],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const ws = currentWorkspaceId!
      // Lapozva (1000 sor felett is teljes), hibánál dob — csonka riport ne szülessen
      const [carsRes, checkins, shifts, stops, fuel] = await Promise.all([
        supabase.from('cars').select('id, plate').eq('workspace_id', ws),
        fetchAll((f, t) => supabase.from('check_ins').select('user_id, work_date, checked_in_at, checked_out_at')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('shifts').select('driver_id, loader_id, work_date')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('route_stops').select('recorded_by, tip, status')
          .eq('workspace_id', ws).gte('recorded_at', range.startISO).lt('recorded_at', range.endISO).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('fuel_logs').select('car_id, liters, amount, consumption, odometer_km')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
      ])
      if (carsRes.error) throw carsRes.error
      const cars = carsRes.data

      // Napi szerep a beosztásból
      const roleByUserDay = new Map<string, 'driver' | 'loader'>()
      for (const s of shifts ?? []) {
        if (s.driver_id) roleByUserDay.set(`${s.driver_id}|${s.work_date}`, 'driver')
        if (s.loader_id) roleByUserDay.set(`${s.loader_id}|${s.work_date}`, 'loader')
      }

      // Fejenkénti összesítés
      const users = new Map<string, UserRow>()
      const u = (id: string): UserRow => {
        if (!users.has(id)) users.set(id, { id, name: '', days: 0, hoursMs: 0, driverDays: 0, loaderDays: 0, stops: 0, tips: 0, shortfall: 0 })
        return users.get(id)!
      }
      const seenDay = new Set<string>()
      // Napközbeni autócserénél egy naphoz több check_ins sor tartozik — a
      // munkaidő ezért a nap TELJES hossza (első be → utolsó ki), nem a sorok összege
      const dayspan = new Map<string, { from: number; to: number | null }>()
      for (const c of checkins ?? []) {
        const key = `${c.user_id}|${c.work_date}`
        if (!seenDay.has(key)) {
          seenDay.add(key)
          const row = u(c.user_id)
          row.days++
          // Ugyanaz a szabály, mint a bérszámításban: beosztás nélküli nap = rakodó
          const daily = roleByUserDay.get(key) ?? 'loader'
          if (daily === 'driver') row.driverDays++
          else row.loaderDays++
        }
        const from = new Date(c.checked_in_at).getTime()
        const to = c.checked_out_at ? new Date(c.checked_out_at).getTime() : null
        const span = dayspan.get(key)
        if (!span) dayspan.set(key, { from, to })
        else {
          span.from = Math.min(span.from, from)
          span.to = to == null ? span.to : span.to == null ? to : Math.max(span.to, to)
        }
      }
      for (const [key, span] of dayspan) {
        if (span.to == null) continue
        u(key.slice(0, key.indexOf('|'))).hoursMs += Math.max(0, span.to - span.from)
      }
      for (const s of stops ?? []) {
        if (!s.recorded_by) continue
        const row = u(s.recorded_by)
        row.stops++
        const tip = Number(s.tip ?? 0)
        if (tip > 0) row.tips += tip
        if (tip < 0) row.shortfall += -tip
      }
      const names = await resolveNames([...users.keys()])
      for (const row of users.values()) row.name = names[row.id] ?? '—'

      // Autónkénti üzemanyag
      const carRows: CarRow[] = (cars ?? []).map((c) => {
        const logs = (fuel ?? []).filter((f) => f.car_id === c.id)
        const kms = logs.map((f) => Number(f.odometer_km)).filter((n) => n > 0)
        const cons = logs.map((f) => Number(f.consumption)).filter((n) => n > 0)
        return {
          id: c.id, plate: c.plate,
          fuelCount: logs.length,
          liters: logs.reduce((a, f) => a + Number(f.liters ?? 0), 0),
          cost: logs.reduce((a, f) => a + Number(f.amount ?? 0), 0),
          avgConsumption: cons.length ? Math.round((cons.reduce((a, b) => a + b, 0) / cons.length) * 100) / 100 : null,
          kmDriven: kms.length >= 2 ? Math.max(...kms) - Math.min(...kms) : null,
        }
      }).filter((c) => c.fuelCount > 0)

      const userRows = [...users.values()].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name))
      return { userRows, carRows }
    },
  })

  async function exportXlsx() {
    if (!data) return
    await exportRowsToXlsx(`riport_${ym}.xlsx`, `Riport ${ym}`, data.userRows.map((r) => ({
      'Munkatárs': r.name, 'Napok': r.days, 'Órák': Math.round((r.hoursMs / 3600000) * 10) / 10,
      'Sofőr nap': r.driverDays, 'Rakodó nap': r.loaderDays,
      'Stopok': r.stops, 'Borravaló': r.tips, 'Kp-hiány': r.shortfall,
    })))
  }

  return (
    <div className="stack">
      <h2>Riportok — {currentWorkspace?.name}</h2>
      <div className="card stack">
        <div className="field">
          <label>Hónap</label>
          <input className="input" type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
        </div>
        <button className="btn secondary sm" disabled={!data || data.userRows.length === 0} onClick={() => void exportXlsx()}>📊 Export Excel</button>
      </div>

      {isLoading && <div className="card"><div className="spinner" /></div>}
      {isError && (
        <div className="alert error">
          A riport betöltése nem sikerült{loadError instanceof Error ? `: ${loadError.message}` : ''}. Frissítsd az oldalt.
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
                <div className="between"><span className="muted">Órák</span><span>{r.hoursMs > 0 ? formatHours(r.hoursMs) : '—'}</span></div>
                <div className="between"><span className="muted">Stopok</span><span>{r.stops}</span></div>
                <div className="between"><span className="muted">Borravaló</span><span style={{ color: 'var(--success)' }}>{formatHuf(r.tips)}</span></div>
                {r.shortfall > 0 && (
                  <div className="between"><span className="muted">Kp-hiány</span><span style={{ color: 'var(--danger)' }}>{formatHuf(r.shortfall)}</span></div>
                )}
              </div>
              <div className="divider" />
            </div>
          ))}
        </div>
      )}

      {data && data.carRows.length > 0 && (
        <div className="card stack">
          <div className="card-title">🚗 Autók — üzemanyag</div>
          {data.carRows.map((c) => (
            <div key={c.id} className="stack" style={{ gap: 4 }}>
              <div style={{ fontWeight: 700 }}>{c.plate}</div>
              <div className="grid-2 small">
                <div className="between"><span className="muted">Tankolás</span><span>{c.fuelCount}×</span></div>
                <div className="between"><span className="muted">Üzemanyag</span><span>{Math.round(c.liters * 10) / 10} l · {formatHuf(c.cost)}</span></div>
                <div className="between"><span className="muted">Átlagfogyasztás</span><span>{c.avgConsumption != null ? `${c.avgConsumption} l/100km` : '—'}</span></div>
                <div className="between"><span className="muted">Km (hónap)</span><span>{c.kmDriven != null ? `${c.kmDriven} km` : '—'}</span></div>
              </div>
              <div className="divider" />
            </div>
          ))}
        </div>
      )}

      {data && data.userRows.length === 0 && data.carRows.length === 0 && (
        <div className="empty"><span className="ico">📈</span>Nincs adat ebben a hónapban.</div>
      )}
    </div>
  )
}
