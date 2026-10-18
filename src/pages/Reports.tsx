import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useWorkspace } from '../context/WorkspaceContext'
import { monthRange, currentYm } from '../lib/payroll'
import { resolveNames } from '../lib/names'
import { formatHuf, formatHours } from '../lib/labels'
import { exportRowsToXlsx } from '../lib/export'
import { shiftMonth, monthTitle } from '../lib/calendar'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'

// Havi riport: ki mennyit dolgozott (nap, szerep, óra) és mit csinált az
// autókkal (ellenőrzés, takarítás, hibabejelentés, esemény); autónként
// üzemanyag + karbantartási események.
interface UserRow {
  id: string; name: string; days: number; hoursMs: number
  driverDays: number; loaderDays: number
  inspections: number; cleanings: number; issues: number; incidents: number
}
interface CarRow {
  id: string; plate: string; category: string | null
  daysUsed: number
  fuelCount: number; liters: number; cost: number
  avgConsumption: number | null; kmDriven: number | null
  inspections: number; cleanings: number; issues: number; openIssues: number; incidents: number
}

export default function Reports() {
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const [ym, setYm] = useState(currentYm())
  const range = useMemo(() => monthRange(ym), [ym])

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: ['reports', currentWorkspaceId, ym, 'v2'],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const ws = currentWorkspaceId!
      // Lapozva (1000 sor felett is teljes), hibánál dob — csonka riport ne szülessen
      const [carsRes, checkins, shifts, fuel, insp, clean, issues, incidents] = await Promise.all([
        supabase.from('cars').select('id, plate, category:car_categories(name)').eq('workspace_id', ws),
        fetchAll((f, t) => supabase.from('check_ins').select('user_id, car_id, work_date, checked_in_at, checked_out_at')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('shifts').select('driver_id, loader_id, work_date')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('fuel_logs').select('car_id, liters, amount, consumption, odometer_km')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('car_inspections').select('user_id, car_id')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('cleanings').select('user_id, car_id')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('car_issues').select('user_id, car_id, status')
          .eq('workspace_id', ws).gte('created_at', range.startISO).lt('created_at', range.endISO).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('incidents').select('user_id, car_id')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
      ])
      if (carsRes.error) throw carsRes.error
      const cars = (carsRes.data ?? []) as unknown as { id: string; plate: string; category: { name: string } | null }[]

      // Napi szerep a beosztásból
      const roleByUserDay = new Map<string, 'driver' | 'loader'>()
      for (const s of shifts ?? []) {
        if (s.driver_id) roleByUserDay.set(`${s.driver_id}|${s.work_date}`, 'driver')
        if (s.loader_id) roleByUserDay.set(`${s.loader_id}|${s.work_date}`, 'loader')
      }

      // Fejenkénti összesítés
      const users = new Map<string, UserRow>()
      const u = (id: string): UserRow => {
        if (!users.has(id)) users.set(id, { id, name: '', days: 0, hoursMs: 0, driverDays: 0, loaderDays: 0, inspections: 0, cleanings: 0, issues: 0, incidents: 0 })
        return users.get(id)!
      }
      const seenDay = new Set<string>()
      // Napközbeni autócserénél egy naphoz több check_ins sor tartozik — a
      // munkaidő ezért a nap TELJES hossza (első be → utolsó ki), nem a sorok összege
      const dayspan = new Map<string, { from: number; to: number | null }>()
      const carDays = new Map<string, Set<string>>()
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
        if (!carDays.has(c.car_id)) carDays.set(c.car_id, new Set())
        carDays.get(c.car_id)!.add(c.work_date)
      }
      for (const [key, span] of dayspan) {
        if (span.to == null) continue
        u(key.slice(0, key.indexOf('|'))).hoursMs += Math.max(0, span.to - span.from)
      }

      // Karbantartási események fejenként és autónként
      const perCar = new Map<string, { inspections: number; cleanings: number; issues: number; openIssues: number; incidents: number }>()
      const pc = (carId: string | null) => {
        if (!carId) return null
        if (!perCar.has(carId)) perCar.set(carId, { inspections: 0, cleanings: 0, issues: 0, openIssues: 0, incidents: 0 })
        return perCar.get(carId)!
      }
      for (const i of insp ?? []) { u(i.user_id).inspections++; const c = pc(i.car_id); if (c) c.inspections++ }
      for (const c of clean ?? []) { u(c.user_id).cleanings++; const x = pc(c.car_id); if (x) x.cleanings++ }
      for (const i of issues ?? []) {
        u(i.user_id).issues++
        const c = pc(i.car_id)
        if (c) { c.issues++; if (i.status !== 'resolved') c.openIssues++ }
      }
      for (const i of incidents ?? []) { u(i.user_id).incidents++; const c = pc(i.car_id); if (c) c.incidents++ }

      const names = await resolveNames([...users.keys()])
      for (const row of users.values()) row.name = names[row.id] ?? '—'

      // Autónként: üzemanyag + karbantartás (ami bármit csinált a hónapban)
      const carRows: CarRow[] = cars.map((c) => {
        const logs = (fuel ?? []).filter((f) => f.car_id === c.id)
        const kms = logs.map((f) => Number(f.odometer_km)).filter((n) => n > 0)
        const cons = logs.map((f) => Number(f.consumption)).filter((n) => n > 0)
        const m = perCar.get(c.id) ?? { inspections: 0, cleanings: 0, issues: 0, openIssues: 0, incidents: 0 }
        return {
          id: c.id, plate: c.plate, category: c.category?.name ?? null,
          daysUsed: carDays.get(c.id)?.size ?? 0,
          fuelCount: logs.length,
          liters: logs.reduce((a, f) => a + Number(f.liters ?? 0), 0),
          cost: logs.reduce((a, f) => a + Number(f.amount ?? 0), 0),
          avgConsumption: cons.length ? Math.round((cons.reduce((a, b) => a + b, 0) / cons.length) * 100) / 100 : null,
          kmDriven: kms.length >= 2 ? Math.max(...kms) - Math.min(...kms) : null,
          ...m,
        }
      }).filter((c) => c.daysUsed > 0 || c.fuelCount > 0 || c.inspections + c.cleanings + c.issues + c.incidents > 0)
        .sort((a, b) => b.daysUsed - a.daysUsed || a.plate.localeCompare(b.plate))

      const userRows = [...users.values()].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name))
      const totals = {
        days: userRows.reduce((s, r) => s + r.days, 0),
        fuel: carRows.reduce((s, c) => s + c.cost, 0),
        liters: carRows.reduce((s, c) => s + c.liters, 0),
        inspections: (insp ?? []).length,
        cleanings: (clean ?? []).length,
        issues: (issues ?? []).length,
        incidents: (incidents ?? []).length,
      }
      return { userRows, carRows, totals }
    },
  })

  async function exportXlsx() {
    if (!data) return
    await exportRowsToXlsx(`riport_${ym}.xlsx`, `Riport ${ym}`, [
      ...data.userRows.map((r) => ({
        'Típus': 'Munkatárs', 'Név / rendszám': r.name, 'Napok': r.days, 'Órák': Math.round((r.hoursMs / 3600000) * 10) / 10,
        'Sofőr nap': r.driverDays, 'Rakodó nap': r.loaderDays,
        'Ellenőrzés': r.inspections, 'Takarítás': r.cleanings, 'Hibabejelentés': r.issues, 'Esemény': r.incidents,
        'Tankolás (db)': '', 'Liter': '', 'Üzemanyag (Ft)': '', 'Átlagfogyasztás': '', 'Km (hónap)': '', 'Nyitott hiba': '',
      })),
      ...data.carRows.map((c) => ({
        'Típus': 'Autó', 'Név / rendszám': c.plate, 'Napok': c.daysUsed, 'Órák': '', 'Sofőr nap': '', 'Rakodó nap': '',
        'Ellenőrzés': c.inspections, 'Takarítás': c.cleanings, 'Hibabejelentés': c.issues, 'Esemény': c.incidents,
        'Tankolás (db)': c.fuelCount, 'Liter': Math.round(c.liters * 10) / 10, 'Üzemanyag (Ft)': c.cost,
        'Átlagfogyasztás': c.avgConsumption ?? '', 'Km (hónap)': c.kmDriven ?? '', 'Nyitott hiba': c.openIssues,
      })),
    ])
  }

  const t = data?.totals
  const hasData = !!data && (data.userRows.length > 0 || data.carRows.length > 0)

  return (
    <div className="stack">
      <h2>Riportok — {currentWorkspace?.name}</h2>
      <div className="card stack primary">
        {/* Hónap-léptető magyar hónapnévvel (a natív month-mező a böngésző nyelvén írna) */}
        <div className="between">
          <button className="icon-btn" aria-label="Előző hónap" onClick={() => setYm(shiftMonth(ym, -1))}><Icon name="chevron-left" /></button>
          <div className="card-title" style={{ margin: 0 }}><Icon name="calendar" />{monthTitle(ym)}</div>
          <button className="icon-btn" aria-label="Következő hónap" disabled={ym >= currentYm()} style={{ opacity: ym >= currentYm() ? 0.35 : 1 }} onClick={() => setYm(shiftMonth(ym, 1))}><Icon name="chevron-right" /></button>
        </div>
        {t && hasData && (
          <div className="grid-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div><div className="tiny muted">Munkanap (fő×nap)</div><div className="num num-lg">{t.days}</div></div>
            <div><div className="tiny muted">Üzemanyag</div><div className="num num-lg">{formatHuf(t.fuel)}</div></div>
            <div><div className="tiny muted">Ellenőrzés / takarítás</div><div className="num num-lg">{t.inspections} / {t.cleanings}</div></div>
            <div><div className="tiny muted">Hiba / esemény</div><div className="num num-lg" style={{ color: t.issues + t.incidents > 0 ? 'var(--warning)' : undefined }}>{t.issues} / {t.incidents}</div></div>
          </div>
        )}
        <div className="btn-grid">
          <button className="btn ghost sm" disabled={ym === currentYm()} onClick={() => setYm(currentYm())}>Ez a hónap</button>
          <button className="btn secondary sm" disabled={!hasData} onClick={() => void exportXlsx()}><Icon name="file-text" />Exportálás Excelbe</button>
        </div>
      </div>

      {isLoading && <><Skeleton rows={3} /><Skeleton rows={3} /></>}
      {isError && (
        <div className="alert error">
          A riport betöltése nem sikerült{loadError instanceof Error ? `: ${loadError.message}` : ''}. Frissítsd az oldalt.
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
                <div className="between"><span className="muted">Szerep</span><span>{r.driverDays} sofőr / {r.loaderDays} rakodó</span></div>
                <div className="between"><span className="muted">Órák</span><span>{r.hoursMs > 0 ? formatHours(r.hoursMs) : '—'}</span></div>
                <div className="between"><span className="muted">Ellenőrzés / takarítás</span><span>{r.inspections} / {r.cleanings}</span></div>
                <div className="between">
                  <span className="muted">Hibabejelentés / esemény</span>
                  <span style={{ color: r.issues + r.incidents > 0 ? 'var(--warning)' : undefined }}>{r.issues} / {r.incidents}</span>
                </div>
              </div>
              <div className="divider" />
            </div>
          ))}
        </div>
      )}

      {data && data.carRows.length > 0 && (
        <div className="card stack">
          <div className="card-title"><Icon name="truck" />Autók — üzemanyag és karbantartás</div>
          {data.carRows.map((c) => (
            <div key={c.id} className="stack" style={{ gap: 4 }}>
              <div className="between">
                <div className="num" style={{ fontSize: 16 }}>
                  {c.plate}{c.category ? <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}> · {c.category}</span> : null}
                </div>
                <span className={`badge ${c.daysUsed > 0 ? 'primary' : ''}`}>{c.daysUsed} nap</span>
              </div>
              <div className="grid-2 pay-grid small">
                <div className="between"><span className="muted">Tankolás</span><span>{c.fuelCount > 0 ? `${c.fuelCount}× · ${Math.round(c.liters * 10) / 10} l` : '—'}</span></div>
                <div className="between"><span className="muted">Üzemanyag</span><span>{c.fuelCount > 0 ? formatHuf(c.cost) : '—'}</span></div>
                <div className="between"><span className="muted">Átlagfogyasztás</span><span>{c.avgConsumption != null ? `${c.avgConsumption} l/100km` : '—'}</span></div>
                <div className="between"><span className="muted">Km (hónap)</span><span>{c.kmDriven != null ? `${c.kmDriven} km` : '—'}</span></div>
                <div className="between"><span className="muted">Ellenőrzés / takarítás</span><span>{c.inspections} / {c.cleanings}</span></div>
                <div className="between">
                  <span className="muted">Hiba / esemény</span>
                  <span style={{ color: c.openIssues > 0 ? 'var(--danger)' : c.issues + c.incidents > 0 ? 'var(--warning)' : undefined }}>
                    {c.issues}{c.openIssues > 0 ? ` (${c.openIssues} nyitott)` : ''} / {c.incidents}
                  </span>
                </div>
              </div>
              <div className="divider" />
            </div>
          ))}
        </div>
      )}

      {data && !hasData && (
        <div className="empty">
          <span className="ico"><Icon name="trending-up" size={40} /></span>
          Nincs adat ebben a hónapban.
          <div style={{ marginTop: 14 }}>
            <button className="btn ghost sm auto" onClick={() => setYm(shiftMonth(ym, -1))}><Icon name="chevron-left" />Előző hónap</button>
          </div>
        </div>
      )}
    </div>
  )
}
