import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useAuth } from '../context/AuthContext'
import { monthRange, currentYm, type PayrollRow } from '../lib/payroll'
import { formatHuf, isCrewRole, formatDate, formatDateTime, parseHuNumber } from '../lib/labels'
import { exportRowsToXlsx } from '../lib/export'
import { openPayslip } from '../lib/payslip'
import ConfirmButton from '../components/ConfirmButton'
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
  const range = useMemo(() => monthRange(ym), [ym])

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: ['payroll', ym],
    queryFn: async () => {
      // admin minden tenantot lát; a hónap-szintű lekérdezések lapozva jönnek
      // (1000 sor felett is teljesek), és minden hiba dob — csonka adatból nem számolunk bért
      const [profilesRes, workspacesRes, rateHistRes, checkins, shifts, adj, stops] = await Promise.all([
        // Státusz-szűrő NÉLKÜL: a hónap közben letiltott munkatársnak is jár a
        // ledolgozott napjaiért a bér — csak a bér nélküli inaktívakat hagyjuk ki lent
        supabase.from('profiles').select('*, workspace:workspaces!profiles_workspace_id_fkey(name)'),
        supabase.from('workspaces').select('id, name, driver_day_rate, loader_day_rate').order('name'),
        // A hónapra ÉRVÉNYES napidíjak: minden olyan sor, ami a hónap kezdetéig
        // hatályba lépett — munkaterületenként a legutolsó számít
        supabase.from('workspace_rate_history')
          .select('workspace_id, valid_from, driver_day_rate, loader_day_rate')
          .lte('valid_from', range.start).order('valid_from'),
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

      // Napidíjak munkaterületenként — a KIVÁLASZTOTT HÓNAPRA érvényes érték.
      // Egy későbbi emelés így nem írja át visszamenőleg a korábbi hónapokat.
      if (rateHistRes.error) throw rateHistRes.error
      const rates: Record<string, WorkspaceRate> = {}
      for (const w of workspaces ?? []) {
        rates[w.id] = { id: w.id, name: w.name, driver: Number(w.driver_day_rate ?? 0), loader: Number(w.loader_day_rate ?? 0) }
      }
      // valid_from szerint növekvő sorrendben jön: az utolsó illeszkedő nyer
      for (const r of rateHistRes.data ?? []) {
        const ws = rates[r.workspace_id]
        if (ws) { ws.driver = Number(r.driver_day_rate ?? 0); ws.loader = Number(r.loader_day_rate ?? 0) }
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
        .filter((p) => isCrewRole(p.role) && (p.status === 'active' || (daysByUser.get(p.id)?.size ?? 0) > 0))
        .map((p) => {
          const dayMap = daysByUser.get(p.id) ?? new Map<string, string>()
          let driverDays = 0
          let loaderDays = 0
          let base = 0
          const workedDays: { date: string; role: 'driver' | 'loader'; rate: number }[] = []
          let driverPay = 0
          let loaderPay = 0
          for (const [date, wsId] of dayMap) {
            const r = rates[wsId ?? p.workspace_id ?? '']
            // Ha nincs beosztott szerep aznap, rakodóként számoljuk (alacsonyabb díj)
            const daily = roleByUserDay.get(`${p.id}|${date}`) ?? 'loader'
            const dayRate = daily === 'driver' ? (r?.driver ?? 0) : (r?.loader ?? 0)
            if (daily === 'driver') { driverDays++; driverPay += dayRate }
            else { loaderDays++; loaderPay += dayRate }
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
            driverPay, loaderPay,
            tips, shortfall, advances, deductions, base,
            status: p.status as string,
            earned: base + tips - shortfall - deductions,
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
        <button className="btn secondary sm" disabled={!data || data.rows.length === 0} onClick={() => void exportXlsx()}>📊 Exportálás Excelbe</button>
      </div>

      {isLoading && <div className="card"><div className="spinner" /></div>}
      {isError && (
        <div className="alert error">
          A béradatok betöltése nem sikerült{loadError instanceof Error ? `: ${loadError.message}` : ''}. Frissítsd az oldalt.
        </div>
      )}

      {data && data.workspaces.map((w) => (
        <RateHistoryCard key={w.id} ws={w} currentYm={ym} />
      ))}

      {data && <MonthLockCard ym={ym} workspaces={data.workspaces} />}

      {!isLoading && (data?.rows.length ?? 0) === 0 && <div className="empty"><span className="ico">🧮</span>Nincs adat a munkatársakról.</div>}

      {data?.rows.map((r) => <PayrollCard key={r.userId} row={r} ym={ym} />)}
    </div>
  )
}

// Napidíj-történet egy munkaterülethez: melyik hónaptól mennyi volt a díj,
// és hónapról hónapra hány százalék volt a változás. Új sor felvételekor a
// bérszámítás AZ ADOTT HÓNAPTÓL automatikusan az új díjjal számol.
// Hónapnevek "-tól/-től" toldalékkal (magyar hangrend szerint, kézzel)
const MONTH_FROM = ['januártól', 'februártól', 'márciustól', 'áprilistól', 'májustól', 'júniustól',
  'júliustól', 'augusztustól', 'szeptembertől', 'októbertől', 'novembertől', 'decembertől']

function pct(from: number, to: number): string | null {
  if (!Number.isFinite(from) || from <= 0 || from === to) return null
  const p = ((to - from) / from) * 100
  const sign = p > 0 ? '+' : ''
  return `${sign}${Math.abs(p) >= 10 ? Math.round(p) : Math.round(p * 10) / 10}%`
}

function RateHistoryCard({ ws, currentYm: nowYm }: { ws: WorkspaceRate; currentYm: string }) {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const isAdmin = profile?.role === 'admin'
  const [open, setOpen] = useState(false)
  const [addFrom, setAddFrom] = useState(nowYm)
  const [driver, setDriver] = useState('')
  const [loader, setLoader] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: history } = useQuery({
    queryKey: ['rate-history', ws.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('workspace_rate_history')
        .select('id, valid_from, driver_day_rate, loader_day_rate')
        .eq('workspace_id', ws.id)
        .order('valid_from', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  const save = useMutation({
    mutationFn: async () => {
      const d = parseHuNumber(driver)
      const l = parseHuNumber(loader)
      if (!Number.isFinite(d) || !Number.isFinite(l) || d < 0 || l < 0) {
        throw new Error('Érvénytelen összeg — írj be számot, pl. 25 000')
      }
      const { error } = await supabase.rpc('set_workspace_rate_from', {
        p_workspace_id: ws.id, p_valid_from: `${addFrom}-01`, p_driver_rate: d, p_loader_rate: l,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setError(null); setDriver(''); setLoader(''); setOpen(false)
      void qc.invalidateQueries({ queryKey: ['rate-history', ws.id] })
      void qc.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'A mentés nem sikerült'),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('delete_workspace_rate', { p_id: id })
      if (error) throw error
    },
    onSuccess: () => {
      setError(null)
      void qc.invalidateQueries({ queryKey: ['rate-history', ws.id] })
      void qc.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'A törlés nem sikerült'),
  })

  // Évekre bontva, azon belül hónapok — a változás az ELŐZŐ (régebbi) sorhoz képest
  const rows = history ?? []
  const byYear = new Map<string, typeof rows>()
  for (const r of rows) {
    if (r.valid_from === '2000-01-01') continue // a kiinduló sor külön látszik
    const y = r.valid_from.slice(0, 4)
    byYear.set(y, [...(byYear.get(y) ?? []), r])
  }
  const base = rows.find((r) => r.valid_from === '2000-01-01')
  const prevOf = (idx: number) => rows[idx + 1] // a lista csökkenő sorrendű
  const today = `${nowYm}-01`
  const activeRow = rows.find((r) => r.valid_from <= today) ?? null

  return (
    <div className="card stack" style={{ borderColor: 'var(--primary)' }}>
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}>💶 Napidíjak — {ws.name}</div>
        {isAdmin && (
          <button className="btn ghost sm" onClick={() => { setOpen((o) => !o); setError(null) }}>
            {open ? 'Bezárás' : '➕ Új díj hónaptól'}
          </button>
        )}
      </div>

      <div className="grid-2 small">
        <div className="between"><span className="muted">Sofőr / nap ({nowYm})</span><span style={{ fontWeight: 700 }}>{formatHuf(ws.driver)}</span></div>
        <div className="between"><span className="muted">Rakodó / nap ({nowYm})</span><span style={{ fontWeight: 700 }}>{formatHuf(ws.loader)}</span></div>
      </div>

      {open && isAdmin && (
        <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div className="field">
            <label>Ettől a hónaptól érvényes</label>
            <input className="input" type="month" value={addFrom} onChange={(e) => setAddFrom(e.target.value)} />
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Sofőr napidíj (Ft)</label>
              <input className="input" inputMode="decimal" value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="pl. 25 000" />
            </div>
            <div className="field">
              <label>Rakodó napidíj (Ft)</label>
              <input className="input" inputMode="decimal" value={loader} onChange={(e) => setLoader(e.target.value)} placeholder="pl. 20 000" />
            </div>
          </div>
          <div className="tiny muted">
            A bérszámítás {addFrom.replace('-', '. ')}. hónaptól automatikusan ezzel számol.
            Az ez elé eső hónapok változatlanok maradnak; zárolt hónapra nem lehet díjat állítani.
          </div>
          <button className="btn sm" disabled={save.isPending || !driver.trim() || !loader.trim()} onClick={() => save.mutate()}>
            {save.isPending ? 'Mentés…' : 'Mentés'}
          </button>
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      <div className="stack" style={{ gap: 6 }}>
        <div className="tiny muted" style={{ fontWeight: 700 }}>Változások</div>
        {[...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, items]) => (
          <div key={year} className="stack" style={{ gap: 2 }}>
            <div className="small" style={{ fontWeight: 800, marginTop: 4 }}>{year}</div>
            {items.map((r) => {
              const idx = rows.indexOf(r)
              const prev = prevOf(idx)
              const dPct = prev ? pct(Number(prev.driver_day_rate), Number(r.driver_day_rate)) : null
              const lPct = prev ? pct(Number(prev.loader_day_rate), Number(r.loader_day_rate)) : null
              const month = MONTH_FROM[Number(r.valid_from.slice(5, 7)) - 1]
              const isActive = activeRow?.id === r.id
              const isFuture = r.valid_from > today
              return (
                <div key={r.id} className="between" style={{
                  padding: '6px 8px', borderRadius: 8,
                  background: isActive ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'transparent',
                  opacity: isFuture ? 0.7 : 1,
                }}>
                  <div className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span className="small" style={{ fontWeight: isActive ? 800 : 600, minWidth: 86 }}>
                      {month}
                    </span>
                    <span className="small">
                      🚚 {formatHuf(Number(r.driver_day_rate))}
                      {dPct && <span style={{ color: dPct.startsWith('+') ? 'var(--success)' : 'var(--danger)' }}> ({dPct})</span>}
                      <span className="muted"> · </span>
                      📦 {formatHuf(Number(r.loader_day_rate))}
                      {lPct && <span style={{ color: lPct.startsWith('+') ? 'var(--success)' : 'var(--danger)' }}> ({lPct})</span>}
                    </span>
                    {isActive && <span className="badge primary">ekkor érvényes</span>}
                    {isFuture && <span className="badge warning">jövőbeli</span>}
                  </div>
                  {isAdmin && (
                    <ConfirmButton className="btn ghost sm auto" confirmLabel="Törlés" disabled={remove.isPending}
                      onConfirm={() => remove.mutate(r.id)}>🗑</ConfirmButton>
                  )}
                </div>
              )
            })}
          </div>
        ))}
        {base && (
          <div className="between" style={{
            padding: '6px 8px', borderRadius: 8, opacity: 0.85,
            background: activeRow?.id === base.id ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'transparent',
          }}>
            <span className="small">
              <span className="muted" style={{ minWidth: 86, display: 'inline-block' }}>kezdettől</span>
              🚚 {formatHuf(Number(base.driver_day_rate))}<span className="muted"> · </span>📦 {formatHuf(Number(base.loader_day_rate))}
            </span>
            {activeRow?.id === base.id && <span className="badge primary">ekkor érvényes</span>}
          </div>
        )}
        {rows.length === 0 && <div className="tiny muted">Még nincs rögzített napidíj.</div>}
      </div>
    </div>
  )
}

function PayrollCard({ row, ym }: { row: PayrollRow; ym: string }) {
  return (
    <div className="card stack">
      <div className="between">
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            {row.name}
            {row.status !== 'active' && <span className="badge danger" style={{ marginLeft: 6 }}>letiltott</span>}
          </div>
          <div className="tiny muted">{row.workspace}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted tiny">Fizetés</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: row.total >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatHuf(row.total)}</div>
        </div>
      </div>

      <div className="grid-2 small">
        <div className="between"><span className="muted">Sofőr nap</span><span>{row.driverDays} nap · {formatHuf(row.driverPay)}</span></div>
        <div className="between"><span className="muted">Rakodó nap</span><span>{row.loaderDays} nap · {formatHuf(row.loaderPay)}</span></div>
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
