import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useAuth } from '../context/AuthContext'
import { monthRange, currentYm, type PayrollRow } from '../lib/payroll'
import { formatHuf, isCrewRole, formatDate, formatDateTime, parseHuNumber } from '../lib/labels'
import { exportRowsToXlsx } from '../lib/export'
import { openPayslip } from '../lib/payslip'
import type { Tables } from '../lib/database.types'

interface WorkspaceRate { id: string; name: string; driver: number; loader: number }

// Havi zárás: zárolt hónapra a DB-trigger tiltja a bér-befolyásoló írásokat
// (előleg/levonás, beosztás, becsekkolás, tankolás). Csak admin zárolhat/oldhat.
function MonthLockCard({ ym, workspaces }: { ym: string; workspaces: WorkspaceRate[] }) {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const { data: locks } = useQuery({
    queryKey: ['payroll-locks', ym],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_locks').select('*').eq('ym', ym)
      if (error) throw error // hibánál ne mutassunk minden hónapot "nyitottnak"
      return data ?? []
    },
  })

  const toggle = useMutation({
    mutationFn: async ({ wsId, locked }: { wsId: string; locked: boolean }) => {
      if (locked) {
        const { error } = await supabase.from('payroll_locks').delete().eq('workspace_id', wsId).eq('ym', ym)
        if (error) throw error
      } else {
        const { error } = await supabase.from('payroll_locks').insert({ workspace_id: wsId, ym, locked_by: profile!.id })
        if (error) throw error
      }
    },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['payroll-locks'] }) },
    onError: (e) => setError(e instanceof Error ? e.message : 'Hiba'),
  })

  return (
    <div className="card stack">
      <div className="card-title">🔒 Havi zárás — {ym}</div>
      <p className="tiny muted" style={{ margin: 0 }}>
        Zárolt hónapban nem módosítható előleg/levonás, beosztás, becsekkolás és tankolás — a bér nem változhat utólag.
      </p>
      {error && <div className="alert error">{error}</div>}
      {workspaces.map((w) => {
        const lock = (locks ?? []).find((l) => l.workspace_id === w.id)
        return (
          <div key={w.id} className="between">
            <div>
              <div className="small" style={{ fontWeight: 700 }}>{w.name}</div>
              {lock && <div className="tiny muted">Zárolva: {formatDateTime(lock.locked_at)}</div>}
            </div>
            <button
              className={`btn sm ${lock ? 'danger' : 'secondary'}`}
              disabled={toggle.isPending}
              onClick={() => toggle.mutate({ wsId: w.id, locked: !!lock })}
            >
              {lock ? '🔓 Feloldás' : '🔒 Hónap zárolása'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default function Payroll() {
  const [ym, setYm] = useState(currentYm())
  const qc = useQueryClient()
  const range = useMemo(() => monthRange(ym), [ym])

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: ['payroll', ym],
    queryFn: async () => {
      // admin minden tenantot lát; a hónap-szintű lekérdezések lapozva jönnek
      // (1000 sor felett is teljesek), és minden hiba dob — csonka adatból nem számolunk bért
      const [profilesRes, workspacesRes, checkins, shifts, adj, stops] = await Promise.all([
        supabase.from('profiles').select('*, workspace:workspaces!profiles_workspace_id_fkey(name)').eq('status', 'active'),
        supabase.from('workspaces').select('id, name, driver_day_rate, loader_day_rate').order('name'),
        fetchAll((f, t) => supabase.from('check_ins').select('user_id, work_date, workspace_id')
          .gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('shifts').select('driver_id, loader_id, work_date, workspace_id')
          .gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('adjustments').select('user_id, type, amount, work_date, reason')
          .gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('route_stops').select('recorded_by, tip')
          .gte('recorded_at', range.startISO).lt('recorded_at', range.endISO).not('tip', 'is', null).order('id').range(f, t)),
      ])
      if (profilesRes.error) throw profilesRes.error
      if (workspacesRes.error) throw workspacesRes.error
      const profiles = profilesRes.data
      const workspaces = workspacesRes.data

      // Napidíjak munkaterületenként
      const rates: Record<string, WorkspaceRate> = {}
      for (const w of workspaces ?? []) {
        rates[w.id] = { id: w.id, name: w.name, driver: Number(w.driver_day_rate ?? 0), loader: Number(w.loader_day_rate ?? 0) }
      }

      // Napi szerep a beosztásból: kulcs `${userId}|${date}` -> 'driver' | 'loader'
      const roleByUserDay = new Map<string, 'driver' | 'loader'>()
      for (const s of shifts ?? []) {
        if (s.driver_id) roleByUserDay.set(`${s.driver_id}|${s.work_date}`, 'driver')
        if (s.loader_id) roleByUserDay.set(`${s.loader_id}|${s.work_date}`, 'loader')
      }

      // Ledolgozott napok usereként (a becsekkolásból, duplázás nélkül)
      const daysByUser = new Map<string, Map<string, string>>() // userId -> (date -> workspaceId)
      for (const c of checkins ?? []) {
        if (!daysByUser.has(c.user_id)) daysByUser.set(c.user_id, new Map())
        daysByUser.get(c.user_id)!.set(c.work_date, c.workspace_id)
      }

      // Előleg/levonás tételesen is (dátum + indok) — a bérlap napi bontásához
      const advByUser = new Map<string, number>()
      const dedByUser = new Map<string, number>()
      const advItemsByUser = new Map<string, { date: string; amount: number; reason: string | null }[]>()
      const dedItemsByUser = new Map<string, { date: string; amount: number; reason: string | null }[]>()
      for (const a of adj ?? []) {
        const map = a.type === 'advance' ? advByUser : dedByUser
        map.set(a.user_id, (map.get(a.user_id) ?? 0) + Number(a.amount))
        const items = a.type === 'advance' ? advItemsByUser : dedItemsByUser
        if (!items.has(a.user_id)) items.set(a.user_id, [])
        items.get(a.user_id)!.push({ date: a.work_date, amount: Number(a.amount), reason: a.reason ?? null })
      }
      // Borravaló (pozitív) és készpénz-hiány (negatív tip) külön gyűjtve —
      // a hiány levonásként jelenik meg, nem "negatív borravalóként".
      const tipsByUser = new Map<string, number>()
      const shortfallByUser = new Map<string, number>()
      for (const s of stops ?? []) {
        if (!s.recorded_by) continue
        const tip = Number(s.tip ?? 0)
        if (tip > 0) tipsByUser.set(s.recorded_by, (tipsByUser.get(s.recorded_by) ?? 0) + tip)
        if (tip < 0) shortfallByUser.set(s.recorded_by, (shortfallByUser.get(s.recorded_by) ?? 0) - tip)
      }

      const rows: PayrollRow[] = ((profiles ?? []) as unknown as (Tables<'profiles'> & { workspace: { name: string } | null })[])
        .filter((p) => isCrewRole(p.role))
        .map((p) => {
          const dayMap = daysByUser.get(p.id) ?? new Map<string, string>()
          let driverDays = 0
          let loaderDays = 0
          let base = 0
          const workedDays: { date: string; role: 'driver' | 'loader'; rate: number }[] = []
          for (const [date, wsId] of dayMap) {
            const r = rates[wsId ?? p.workspace_id ?? '']
            // Ha nincs beosztott szerep aznap, rakodóként számoljuk (alacsonyabb díj)
            const daily = roleByUserDay.get(`${p.id}|${date}`) ?? 'loader'
            const dayRate = daily === 'driver' ? (r?.driver ?? 0) : (r?.loader ?? 0)
            if (daily === 'driver') driverDays++
            else loaderDays++
            base += dayRate
            workedDays.push({ date, role: daily, rate: dayRate })
          }
          workedDays.sort((a, b) => a.date.localeCompare(b.date))
          const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date)
          const wsRate = rates[p.workspace_id ?? '']
          const tips = tipsByUser.get(p.id) ?? 0
          const shortfall = shortfallByUser.get(p.id) ?? 0
          const advances = advByUser.get(p.id) ?? 0
          const deductions = dedByUser.get(p.id) ?? 0
          return {
            userId: p.id, name: p.full_name || p.email || '—', workspace: p.workspace?.name ?? '—',
            workspaceId: p.workspace_id, driverDays, loaderDays, days: driverDays + loaderDays,
            driverRate: wsRate?.driver ?? 0, loaderRate: wsRate?.loader ?? 0,
            tips, shortfall, advances, deductions, base,
            total: base + tips - shortfall - advances - deductions,
            workedDays,
            advanceItems: (advItemsByUser.get(p.id) ?? []).sort(byDate),
            deductionItems: (dedItemsByUser.get(p.id) ?? []).sort(byDate),
          }
        })
        .sort((a, b) => a.workspace.localeCompare(b.workspace) || a.name.localeCompare(b.name))

      const wsList: WorkspaceRate[] = Object.values(rates).sort((a, b) => a.name.localeCompare(b.name))
      return { rows, workspaces: wsList }
    },
  })

  const [rateError, setRateError] = useState<string | null>(null)
  const setRates = useMutation({
    mutationFn: async ({ id, driver, loader }: { id: string; driver: number; loader: number }) => {
      const { error } = await supabase.rpc('set_workspace_rates', { p_workspace_id: id, p_driver_rate: driver, p_loader_rate: loader })
      if (error) throw error
    },
    onSuccess: () => { setRateError(null); void qc.invalidateQueries({ queryKey: ['payroll'] }) },
    onError: (e) => setRateError(e instanceof Error ? e.message : 'A napidíj mentése nem sikerült'),
  })

  async function exportXlsx() {
    if (!data) return
    await exportRowsToXlsx(`ber_${ym}.xlsx`, `Bér ${ym}`, data.rows.map((r) => ({
      'Munkatárs': r.name, 'Munkaterület': r.workspace,
      'Sofőr nap': r.driverDays, 'Rakodó nap': r.loaderDays, 'Ledolgozott nap': r.days,
      'Sofőr napidíj': r.driverRate, 'Rakodó napidíj': r.loaderRate, 'Alapbér': r.base,
      'Borravaló': r.tips, 'Kp-hiány': r.shortfall, 'Előleg': r.advances, 'Levonás': r.deductions, 'Fizetés': r.total,
    })))
  }

  return (
    <div className="stack">
      <h2>Bér / kimutatás</h2>
      <div className="card stack">
        <div className="field">
          <label>Hónap</label>
          <input className="input" type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
        </div>
        <button className="btn secondary sm" disabled={!data || data.rows.length === 0} onClick={() => void exportXlsx()}>📊 Export Excel</button>
      </div>

      {isLoading && <div className="card"><div className="spinner" /></div>}
      {isError && (
        <div className="alert error">
          A béradatok betöltése nem sikerült{loadError instanceof Error ? `: ${loadError.message}` : ''}. Frissítsd az oldalt.
        </div>
      )}
      {rateError && <div className="alert error">{rateError}</div>}

      {data && data.workspaces.map((w) => (
        <RateCard key={w.id} ws={w} onSave={(driver, loader) => setRates.mutate({ id: w.id, driver, loader })} saving={setRates.isPending} />
      ))}

      {data && <MonthLockCard ym={ym} workspaces={data.workspaces} />}

      {!isLoading && (data?.rows.length ?? 0) === 0 && <div className="empty"><span className="ico">🧮</span>Nincs munkatárs adat.</div>}

      {data?.rows.map((r) => <PayrollCard key={r.userId} row={r} ym={ym} />)}
    </div>
  )
}

function RateCard({ ws, onSave, saving }: { ws: WorkspaceRate; onSave: (driver: number, loader: number) => void; saving: boolean }) {
  const [edit, setEdit] = useState(false)
  const [driver, setDriver] = useState(String(ws.driver))
  const [loader, setLoader] = useState(String(ws.loader))
  const [inputError, setInputError] = useState<string | null>(null)

  return (
    <div className="card stack" style={{ borderColor: 'var(--primary)' }}>
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}>💶 Napidíjak — {ws.name}</div>
        {!edit && <button className="btn ghost sm" onClick={() => setEdit(true)}>Módosítás</button>}
      </div>
      {edit ? (
        <div className="stack">
          <div className="grid-2">
            <div className="field">
              <label>Sofőr napidíj (Ft)</label>
              <input className="input" inputMode="decimal" value={driver} onChange={(e) => setDriver(e.target.value)} />
            </div>
            <div className="field">
              <label>Rakodó napidíj (Ft)</label>
              <input className="input" inputMode="decimal" value={loader} onChange={(e) => setLoader(e.target.value)} />
            </div>
          </div>
          {inputError && <div className="alert error">{inputError}</div>}
          <div className="btn-grid">
            <button className="btn ghost sm" onClick={() => { setEdit(false); setInputError(null); setDriver(String(ws.driver)); setLoader(String(ws.loader)) }}>Mégse</button>
            <button className="btn sm" disabled={saving} onClick={() => {
              const d = parseHuNumber(driver)
              const l = parseHuNumber(loader)
              // Érvénytelen bevitelből nem lehet csendben 0 Ft napidíj
              if (!Number.isFinite(d) || !Number.isFinite(l) || d < 0 || l < 0) {
                setInputError('Érvénytelen összeg — írj be számot, pl. 25 000')
                return
              }
              setInputError(null)
              onSave(d, l)
              setEdit(false)
            }}>Mentés</button>
          </div>
        </div>
      ) : (
        <div className="grid-2 small">
          <div className="between"><span className="muted">Sofőr / nap</span><span style={{ fontWeight: 700 }}>{formatHuf(ws.driver)}</span></div>
          <div className="between"><span className="muted">Rakodó / nap</span><span style={{ fontWeight: 700 }}>{formatHuf(ws.loader)}</span></div>
        </div>
      )}
    </div>
  )
}

function PayrollCard({ row, ym }: { row: PayrollRow; ym: string }) {
  return (
    <div className="card stack">
      <div className="between">
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{row.name}</div>
          <div className="tiny muted">{row.workspace}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted tiny">Fizetés</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: row.total >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatHuf(row.total)}</div>
        </div>
      </div>

      <div className="grid-2 small">
        <div className="between"><span className="muted">Sofőr nap</span><span>{row.driverDays} × {formatHuf(row.driverRate)}</span></div>
        <div className="between"><span className="muted">Rakodó nap</span><span>{row.loaderDays} × {formatHuf(row.loaderRate)}</span></div>
        <div className="between"><span className="muted">Ledolgozott nap</span><span>{row.days}</span></div>
        <div className="between"><span className="muted">Alapbér</span><span>{formatHuf(row.base)}</span></div>
        <div className="between"><span className="muted">Borravaló</span><span style={{ color: 'var(--success)' }}>{formatHuf(row.tips)}</span></div>
        {row.shortfall > 0 && (
          <div className="between"><span className="muted">Kp-hiány</span><span style={{ color: 'var(--danger)' }}>−{formatHuf(row.shortfall)}</span></div>
        )}
        <div className="between"><span className="muted">Előleg</span><span style={{ color: 'var(--warning)' }}>−{formatHuf(row.advances)}</span></div>
        <div className="between"><span className="muted">Levonás</span><span style={{ color: 'var(--danger)' }}>−{formatHuf(row.deductions)}</span></div>
      </div>

      {row.advanceItems.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          <div className="tiny muted" style={{ fontWeight: 700 }}>Előlegek — csak itt látható, a bérlapra nem kerül rá</div>
          {row.advanceItems.map((a, i) => (
            <div key={i} className="between tiny">
              <span className="muted">{formatDate(a.date)}{a.reason ? ` · ${a.reason}` : ''}</span>
              <span style={{ color: 'var(--warning)' }}>−{formatHuf(a.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <button className="btn secondary sm" onClick={() => openPayslip(row, ym)}>📄 Bérlap (nyomtatás / PDF)</button>
    </div>
  )
}
