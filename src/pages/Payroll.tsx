import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useAuth } from '../context/AuthContext'
import { monthRange, currentYm, type PayrollRow, type PayRole } from '../lib/payroll'
import { formatHuf, isCrewRole, formatDate, formatDateTime, parseHuNumber } from '../lib/labels'
import { exportRowsToXlsx } from '../lib/export'
import { openPayslip } from '../lib/payslip'
import ConfirmButton from '../components/ConfirmButton'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'
import { shiftMonth, monthTitle } from '../lib/calendar'
import type { Tables } from '../lib/database.types'

interface WorkspaceRate { id: string; name: string; driver: number; loader: number; trainee: number; box: number; boxTrainee: number; box2: number }

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
      <div className="card-title"><Icon name="lock" />Havi zárás — {monthTitle(ym)}</div>
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
            {/* Két koppintás: a zárolás az összes vezető szerkesztését tiltja, a feloldás a bért teszi módosíthatóvá */}
            <ConfirmButton
              className={`btn sm ${lock ? 'danger-outline' : 'secondary'}`}
              confirmLabel={lock ? 'Biztos? Feloldás' : 'Biztos? Zárolás'}
              disabled={toggle.isPending}
              onConfirm={() => toggle.mutate({ wsId: w.id, locked: !!lock })}
            >
              {lock ? <><Icon name="unlock" />Feloldás</> : <><Icon name="lock" />Hónap zárolása</>}
            </ConfirmButton>
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
    queryKey: ['payroll', ym, 'v4'],
    queryFn: async () => {
      // admin minden tenantot lát; a hónap-szintű lekérdezések lapozva jönnek
      // (1000 sor felett is teljesek), és minden hiba dob — csonka adatból nem számolunk bért
      const [profilesRes, workspacesRes, rateHistRes, checkins, shifts, adj] = await Promise.all([
        // Státusz-szűrő NÉLKÜL: a hónap közben letiltott munkatársnak is jár a
        // ledolgozott napjaiért a bér — csak a bér nélküli inaktívakat hagyjuk ki lent
        supabase.from('profiles').select('*, workspace:workspaces!profiles_workspace_id_fkey(name)'),
        supabase.from('workspaces').select('id, name, driver_day_rate, loader_day_rate, trainee_day_rate, box_day_rate, box_trainee_day_rate, box_round2_day_rate').order('name'),
        // A hónapra ÉRVÉNYES napidíjak: minden olyan sor, ami a hónap kezdetéig
        // hatályba lépett — munkaterületenként a legutolsó számít
        supabase.from('workspace_rate_history')
          .select('workspace_id, valid_from, driver_day_rate, loader_day_rate, trainee_day_rate, box_day_rate, box_trainee_day_rate, box_round2_day_rate')
          .lte('valid_from', range.start).order('valid_from'),
        fetchAll((f, t) => supabase.from('check_ins').select('user_id, work_date, workspace_id')
          .gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('shifts').select('driver_id, loader_id, trainee_id, work_date, workspace_id, round, car:cars(category:car_categories(box_sheet))')
          .gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('adjustments').select('user_id, type, amount, work_date, reason')
          .gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
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
        rates[w.id] = { id: w.id, name: w.name, driver: Number(w.driver_day_rate ?? 0), loader: Number(w.loader_day_rate ?? 0), trainee: Number(w.trainee_day_rate ?? 0), box: Number(w.box_day_rate ?? 0), boxTrainee: Number(w.box_trainee_day_rate ?? 0), box2: Number(w.box_round2_day_rate ?? 0) }
      }
      // valid_from szerint növekvő sorrendben jön: az utolsó illeszkedő nyer
      for (const r of rateHistRes.data ?? []) {
        const ws = rates[r.workspace_id]
        if (ws) { ws.driver = Number(r.driver_day_rate ?? 0); ws.loader = Number(r.loader_day_rate ?? 0); ws.trainee = Number(r.trainee_day_rate ?? 0); ws.box = Number(r.box_day_rate ?? 0); ws.boxTrainee = Number(r.box_trainee_day_rate ?? 0); ws.box2 = Number(r.box_round2_day_rate ?? 0) }
      }

      // Napi szerep a beosztásból: kulcs `${userId}|${date}` -> XL sofőr / XL rakodó / Box sofőr / betanuló
      // (két körnél ugyanaz az ember ugyanúgy egy napot kap — a szerep a sofőr, ha bármelyik körben az)
      const roleByUserDay = new Map<string, PayRole>()
      const rank: Record<PayRole, number> = { trainee: 0, box_trainee: 0, loader: 1, box: 2, driver: 2 }
      const setRole = (uid: string | null, date: string, role: PayRole) => {
        if (!uid) return
        const k = `${uid}|${date}`
        const cur = roleByUserDay.get(k)
        if (!cur || rank[role] > rank[cur]) roleByUserDay.set(k, role)
      }
      // Box sofőr: mely köröket vitte aznap (a 2. körre külön díj jár)
      const boxRounds = new Map<string, Set<number>>()
      for (const s of shifts ?? []) {
        const isBox = !!(s.car as unknown as { category: { box_sheet: boolean } | null } | null)?.category?.box_sheet
        if (isBox && s.driver_id) {
          const k = `${s.driver_id}|${s.work_date}`
          if (!boxRounds.has(k)) boxRounds.set(k, new Set())
          boxRounds.get(k)!.add(s.round ?? 1)
        }
        setRole(s.trainee_id, s.work_date, isBox ? 'box_trainee' : 'trainee')
        setRole(s.loader_id, s.work_date, 'loader')
        setRole(s.driver_id, s.work_date, isBox ? 'box' : 'driver')
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
      const rows: PayrollRow[] = ((profiles ?? []) as unknown as (Tables<'profiles'> & { workspace: { name: string } | null })[])
        .filter((p) => isCrewRole(p.role) && (p.status === 'active' || (daysByUser.get(p.id)?.size ?? 0) > 0))
        .map((p) => {
          const dayMap = daysByUser.get(p.id) ?? new Map<string, string>()
          let driverDays = 0
          let loaderDays = 0
          let traineeDays = 0
          let boxDays = 0
          let boxTraineeDays = 0
          let boxRound2Days = 0
          let base = 0
          const workedDays: { date: string; role: PayRole; rate: number }[] = []
          let driverPay = 0
          let loaderPay = 0
          let traineePay = 0
          let boxPay = 0
          let boxTraineePay = 0
          let boxRound2Pay = 0
          for (const [date, wsId] of dayMap) {
            const r = rates[wsId ?? p.workspace_id ?? '']
            // Ha nincs beosztott szerep aznap, rakodóként számoljuk (alacsonyabb díj)
            const daily = roleByUserDay.get(`${p.id}|${date}`) ?? 'loader'
            // Box sofőr: 1. kör díja + (ha a 2. kört is vitte) a 2. kör díja
            const rounds = daily === 'box' ? (boxRounds.get(`${p.id}|${date}`) ?? new Set([1])) : null
            const r2 = rounds?.has(2) ? (r?.box2 ?? 0) : 0
            const dayRate = daily === 'driver' ? (r?.driver ?? 0) : daily === 'box' ? (r?.box ?? 0) + r2 : daily === 'trainee' ? (r?.trainee ?? 0) : daily === 'box_trainee' ? (r?.boxTrainee ?? 0) : (r?.loader ?? 0)
            if (daily === 'driver') { driverDays++; driverPay += dayRate }
            else if (daily === 'box') { boxDays++; boxPay += (r?.box ?? 0); if (rounds?.has(2)) { boxRound2Days++; boxRound2Pay += r2 } }
            else if (daily === 'trainee') { traineeDays++; traineePay += dayRate }
            else if (daily === 'box_trainee') { boxTraineeDays++; boxTraineePay += dayRate }
            else { loaderDays++; loaderPay += dayRate }
            base += dayRate
            workedDays.push({ date, role: daily, rate: dayRate, rounds: rounds?.has(2) ? 2 : undefined })
          }
          workedDays.sort((a, b) => a.date.localeCompare(b.date))
          const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date)
          const wsRate = rates[p.workspace_id ?? '']
          const advances = advByUser.get(p.id) ?? 0
          const deductions = dedByUser.get(p.id) ?? 0
          return {
            userId: p.id, name: p.full_name || p.email || '—', workspace: p.workspace?.name ?? '—',
            workspaceId: p.workspace_id, driverDays, loaderDays, traineeDays, boxDays, boxTraineeDays, boxRound2Days, days: driverDays + loaderDays + traineeDays + boxDays + boxTraineeDays,
            driverRate: wsRate?.driver ?? 0, loaderRate: wsRate?.loader ?? 0, traineeRate: wsRate?.trainee ?? 0, boxRate: wsRate?.box ?? 0, boxTraineeRate: wsRate?.boxTrainee ?? 0, boxRound2Rate: wsRate?.box2 ?? 0,
            driverPay, loaderPay, traineePay, boxPay, boxTraineePay, boxRound2Pay,
            advances, deductions, base,
            status: p.status as string,
            earned: base - deductions,
            total: base - advances - deductions,
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
      'XL sofőr nap': r.driverDays, 'XL rakodó nap': r.loaderDays, 'Box sofőr nap': r.boxDays, 'Box 2. kör': r.boxRound2Days, 'XL betanuló nap': r.traineeDays, 'Box betanuló nap': r.boxTraineeDays, 'Ledolgozott nap': r.days,
      'XL sofőr napidíj': r.driverRate, 'XL rakodó napidíj': r.loaderRate, 'Box 1. kör díj': r.boxRate, 'Box 2. kör díj': r.boxRound2Rate, 'XL betanuló napidíj': r.traineeRate, 'Box betanuló napidíj': r.boxTraineeRate, 'Alapbér': r.base,
      'Előleg': r.advances, 'Levonás': r.deductions, 'Fizetés': r.total,
    })))
  }

  // Alapból csak azok, akiknél van mit elszámolni (nap, előleg vagy levonás) —
  // 20+ nullás sor elrejtené a lényeget. Az export mindig az összes sort viszi.
  const [onlyWorked, setOnlyWorked] = useState(true)
  const relevant = (r: PayrollRow) => r.days > 0 || r.advances > 0 || r.deductions > 0
  const shownRows = (data?.rows ?? []).filter((r) => !onlyWorked || relevant(r))
  const workedCount = (data?.rows ?? []).filter(relevant).length
  const totals = (data?.rows ?? []).reduce(
    (a, r) => ({ pay: a.pay + r.total, days: a.days + r.days, deductions: a.deductions + r.deductions, advances: a.advances + r.advances }),
    { pay: 0, days: 0, deductions: 0, advances: 0 },
  )

  return (
    <div className="stack">
      <h2>Bér / kimutatás</h2>
      <div className="card stack primary">
        {/* Hónap-léptető magyar hónapnévvel (a natív month-mező a böngésző nyelvén írna) */}
        <div className="between">
          <button className="icon-btn" aria-label="Előző hónap" onClick={() => setYm(shiftMonth(ym, -1))}><Icon name="chevron-left" /></button>
          <div className="card-title" style={{ margin: 0 }}><Icon name="calculator" />{monthTitle(ym)}</div>
          <button className="icon-btn" aria-label="Következő hónap" onClick={() => setYm(shiftMonth(ym, 1))}><Icon name="chevron-right" /></button>
        </div>
        {data && (
          <div className="grid-2">
            <div><div className="tiny muted">Kifizetendő összesen</div><div className="num num-lg">{formatHuf(totals.pay)}</div></div>
            <div><div className="tiny muted">Ledolgozott napok</div><div className="num num-lg">{totals.days}</div></div>
            <div><div className="tiny muted">Levonás</div><div className="num" style={{ color: totals.deductions > 0 ? 'var(--danger)' : undefined }}>{formatHuf(totals.deductions)}</div></div>
            <div><div className="tiny muted">Felvett előleg</div><div className="num">{formatHuf(totals.advances)}</div></div>
          </div>
        )}
        <div className="btn-grid">
          <button className="btn ghost sm" disabled={ym === currentYm()} onClick={() => setYm(currentYm())}>Ez a hónap</button>
          <button className="btn secondary sm" disabled={!data || data.rows.length === 0} onClick={() => void exportXlsx()}><Icon name="file-text" />Exportálás Excelbe</button>
        </div>
      </div>

      {isLoading && <><Skeleton rows={3} /><Skeleton rows={4} /></>}
      {isError && (
        <div className="alert error">
          A béradatok betöltése nem sikerült{loadError instanceof Error ? `: ${loadError.message}` : ''}. Frissítsd az oldalt.
        </div>
      )}

      {data && data.workspaces.map((w) => (
        <RateHistoryCard key={w.id} ws={w} currentYm={ym} />
      ))}

      {data && <MonthLockCard ym={ym} workspaces={data.workspaces} />}

      {!isLoading && (data?.rows.length ?? 0) === 0 && <div className="empty"><span className="ico"><Icon name="calculator" size={40} /></span>Nincs adat a munkatársakról.</div>}

      {data && data.rows.length > 0 && (
        <div className="between">
          <div className="card-title" style={{ margin: 0 }}><Icon name="users" />Munkatársak</div>
          <div className="row" style={{ gap: 6 }}>
            {([[true, `Elszámolás · ${workedCount}`], [false, `Mind · ${data.rows.length}`]] as const).map(([v, label]) => (
              <button key={String(v)} type="button" className={`badge ${onlyWorked === v ? 'primary' : ''}`}
                style={{ cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, minHeight: 32 }}
                onClick={() => setOnlyWorked(v)}>{label}</button>
            ))}
          </div>
        </div>
      )}
      {data && data.rows.length > 0 && shownRows.length === 0 && (
        <div className="empty"><span className="ico"><Icon name="calculator" size={40} /></span>Ebben a hónapban még nincs elszámolandó tétel.</div>
      )}

      {shownRows.map((r) => <PayrollCard key={r.userId} row={r} ym={ym} />)}
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
  const [trainee, setTrainee] = useState('')
  const [box, setBox] = useState('')
  const [boxTrainee, setBoxTrainee] = useState('')
  const [box2, setBox2] = useState('')
  // Kezdeti díj: minden hónapra érvényes, amíg nincs későbbi díj (valid_from = 2000-01-01)
  const [asBase, setAsBase] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: history } = useQuery({
    queryKey: ['rate-history', ws.id, 'v3'],
    queryFn: async () => {
      const { data, error } = await supabase.from('workspace_rate_history')
        .select('id, valid_from, driver_day_rate, loader_day_rate, trainee_day_rate, box_day_rate, box_trainee_day_rate, box_round2_day_rate')
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
      const tr = trainee.trim() ? parseHuNumber(trainee) : 0
      const bx = box.trim() ? parseHuNumber(box) : 0
      const bt = boxTrainee.trim() ? parseHuNumber(boxTrainee) : 0
      const b2 = box2.trim() ? parseHuNumber(box2) : 0
      if (!Number.isFinite(d) || !Number.isFinite(l) || !Number.isFinite(tr) || !Number.isFinite(bx) || !Number.isFinite(bt) || !Number.isFinite(b2) || d < 0 || l < 0 || tr < 0 || bx < 0 || bt < 0 || b2 < 0) {
        throw new Error('Érvénytelen összeg — írj be számot, pl. 25 000')
      }
      const { error } = await supabase.rpc('set_workspace_rate_from', {
        p_workspace_id: ws.id, p_valid_from: asBase ? '2000-01-01' : `${addFrom}-01`, p_driver_rate: d, p_loader_rate: l, p_trainee_rate: tr, p_box_rate: bx, p_box_trainee_rate: bt, p_box_round2_rate: b2,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setError(null); setDriver(''); setLoader(''); setTrainee(''); setBox(''); setBoxTrainee(''); setBox2(''); setAsBase(false); setOpen(false)
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
        <div className="card-title" style={{ margin: 0 }}><Icon name="banknote" />Napidíjak — {ws.name}</div>
        {isAdmin && (
          <button className="btn ghost sm" onClick={() => { setOpen((o) => !o); setError(null) }}>
            {open ? 'Bezárás' : <><Icon name="plus" />Emelés hónaptól</>}
          </button>
        )}
      </div>

      <div className="grid-2 small">
        <div className="between"><span className="muted row" style={{ gap: 4, whiteSpace: 'nowrap' }}><Icon name="truck" size={14} />XL sofőr/nap</span><span className="num">{formatHuf(ws.driver)}</span></div>
        <div className="between"><span className="muted row" style={{ gap: 4, whiteSpace: 'nowrap' }}><Icon name="package" size={14} />XL rakodó/nap</span><span className="num">{formatHuf(ws.loader)}</span></div>
        <div className="between"><span className="muted row" style={{ gap: 4, whiteSpace: 'nowrap' }}><Icon name="car" size={14} />Box 1. kör/nap</span><span className="num">{formatHuf(ws.box)}</span></div>
        <div className="between"><span className="muted row" style={{ gap: 4, whiteSpace: 'nowrap' }}><Icon name="repeat" size={14} />Box 2. kör (ráadás)</span><span className="num">{formatHuf(ws.box2)}</span></div>
        <div className="between"><span className="muted row" style={{ gap: 4, whiteSpace: 'nowrap' }}><Icon name="user" size={14} />XL betanuló/nap</span><span className="num">{formatHuf(ws.trainee)}</span></div>
        <div className="between"><span className="muted row" style={{ gap: 4, whiteSpace: 'nowrap' }}><Icon name="user" size={14} />Box betanuló/nap</span><span className="num">{formatHuf(ws.boxTrainee)}</span></div>
      </div>
      <div className="tiny muted" style={{ marginTop: -6 }}>Érvényes: {monthTitle(nowYm)}</div>

      {open && isAdmin && (
        <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={asBase} onChange={(e) => setAsBase(e.target.checked)} style={{ width: 20, height: 20 }} />
            <span className="small">Kezdeti (alap) díj — ezzel indul minden, amíg egy későbbi hónaptól nem emelsz</span>
          </label>
          {!asBase && (
            <div className="field">
              <label>Ettől a hónaptól érvényes</label>
              <input className="input" type="month" value={addFrom} onChange={(e) => setAddFrom(e.target.value)} />
            </div>
          )}
          <div className="grid-2">
            <div className="field">
              <label>XL sofőr napidíj (Ft)</label>
              <input className="input" inputMode="decimal" value={driver} onFocus={(e) => e.target.select()} onChange={(e) => setDriver(e.target.value)} placeholder="pl. 25 000" />
            </div>
            <div className="field">
              <label>XL rakodó napidíj (Ft)</label>
              <input className="input" inputMode="decimal" value={loader} onFocus={(e) => e.target.select()} onChange={(e) => setLoader(e.target.value)} placeholder="pl. 20 000" />
            </div>
            <div className="field">
              <label>Box sofőr 1. kör napidíj (Ft)</label>
              <input className="input" inputMode="decimal" value={box} onFocus={(e) => e.target.select()} onChange={(e) => setBox(e.target.value)} placeholder="pl. 22 000" />
            </div>
            <div className="field">
              <label>Box 2. kör díja (Ft) — erre jön rá, ha aznap a 2. kört is viszi</label>
              <input className="input" inputMode="decimal" value={box2} onFocus={(e) => e.target.select()} onChange={(e) => setBox2(e.target.value)} placeholder="pl. 10 000" />
            </div>
            <div className="field">
              <label>XL betanuló napidíj (Ft)</label>
              <input className="input" inputMode="decimal" value={trainee} onFocus={(e) => e.target.select()} onChange={(e) => setTrainee(e.target.value)} placeholder="0 = nem fizetett" />
            </div>
            <div className="field">
              <label>Box betanuló napidíj (Ft)</label>
              <input className="input" inputMode="decimal" value={boxTrainee} onFocus={(e) => e.target.select()} onChange={(e) => setBoxTrainee(e.target.value)} placeholder="0 = nem fizetett" />
            </div>
          </div>
          <div className="tiny muted">
            {asBase
              ? 'A kezdeti díj a kiindulás: minden hónapra ez számít, amíg egy későbbi „ettől a hónaptól” emelés felül nem írja.'
              : `${addFrom.replace('-', '. ')}. hónaptól ez a díj számít minden későbbi hónapra is, amíg újra nem módosítod — nem kell havonta beírni. Az ez elé eső hónapok változatlanok maradnak.`}
            {' '}Zárolt hónapra nem lehet díjat állítani.
          </div>
          <button className="btn sm" disabled={save.isPending || !driver.trim() || !loader.trim()} onClick={() => save.mutate()}>
            {save.isPending ? 'Mentés…' : 'Mentés'}
          </button>
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      <div className="stack" style={{ gap: 6 }}>
        <div className="tiny muted" style={{ fontWeight: 700 }}>Emelések (onnantól érvényes, amíg újabb nincs)</div>
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
                      <Icon name="truck" size={14} style={{ verticalAlign: -2 }} /> {formatHuf(Number(r.driver_day_rate))}
                      {dPct && <span style={{ color: dPct.startsWith('+') ? 'var(--success)' : 'var(--danger)' }}> ({dPct})</span>}
                      <span className="muted"> · </span>
                      <Icon name="package" size={14} style={{ verticalAlign: -2 }} /> {formatHuf(Number(r.loader_day_rate))}
                      {lPct && <span style={{ color: lPct.startsWith('+') ? 'var(--success)' : 'var(--danger)' }}> ({lPct})</span>}
                      {Number(r.box_day_rate) > 0 && <><span className="muted"> · </span><Icon name="car" size={14} style={{ verticalAlign: -2 }} /> {formatHuf(Number(r.box_day_rate))}{Number(r.box_round2_day_rate) > 0 ? ` +${formatHuf(Number(r.box_round2_day_rate))} (2. kör)` : ''}</>}
                      {Number(r.trainee_day_rate) > 0 && <><span className="muted"> · </span><Icon name="user" size={14} style={{ verticalAlign: -2 }} /> XL bet. {formatHuf(Number(r.trainee_day_rate))}</>}
                      {Number(r.box_trainee_day_rate) > 0 && <><span className="muted"> · </span><Icon name="user" size={14} style={{ verticalAlign: -2 }} /> Box bet. {formatHuf(Number(r.box_trainee_day_rate))}</>}
                    </span>
                    {isActive && <span className="badge primary">ekkor érvényes</span>}
                    {isFuture && <span className="badge warning">jövőbeli</span>}
                  </div>
                  {isAdmin && (
                    <ConfirmButton className="btn ghost sm auto" confirmLabel="Törlés" disabled={remove.isPending}
                      onConfirm={() => remove.mutate(r.id)} aria-label="Díj törlése"><Icon name="trash" size={16} /></ConfirmButton>
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
              <span className="muted" style={{ minWidth: 86, display: 'inline-block' }}>kezdeti díj</span>
              <Icon name="truck" size={14} style={{ verticalAlign: -2 }} /> {formatHuf(Number(base.driver_day_rate))}<span className="muted"> · </span><Icon name="package" size={14} style={{ verticalAlign: -2 }} /> {formatHuf(Number(base.loader_day_rate))}
            </span>
            <span className="row" style={{ gap: 6 }}>
              {activeRow?.id === base.id && <span className="badge primary">ekkor érvényes</span>}
              {isAdmin && (
                <button className="btn ghost sm auto" style={{ minHeight: 28, padding: '0 8px' }} title="Kezdeti díj módosítása"
                  onClick={() => { setAsBase(true); setDriver(String(base.driver_day_rate ?? 0)); setLoader(String(base.loader_day_rate ?? 0)); setBox(String(base.box_day_rate ?? 0)); setBox2(String(base.box_round2_day_rate ?? 0)); setTrainee(String(base.trainee_day_rate ?? 0)); setBoxTrainee(String(base.box_trainee_day_rate ?? 0)); setOpen(true); setError(null) }}>
                  <Icon name="pencil" size={14} />
                </button>
              )}
            </span>
          </div>
        )}
        {!base && isAdmin && (
          <div className="tiny muted">Nincs kezdeti díj: az „Emelés hónaptól” gombbal, a „Kezdeti (alap) díj” pipával adható meg.</div>
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
          <div className="num num-lg" style={{ color: row.total < 0 ? 'var(--danger)' : row.total > 0 ? 'var(--success)' : 'var(--text-dim)' }}>{formatHuf(row.total)}</div>
        </div>
      </div>

      <div className="grid-2 pay-grid small">
        {row.driverDays > 0 && <div className="between"><span className="muted">XL sofőrként</span><span>{row.driverDays} nap · {formatHuf(row.driverPay)}</span></div>}
        {row.loaderDays > 0 && <div className="between"><span className="muted">XL rakodóként</span><span>{row.loaderDays} nap · {formatHuf(row.loaderPay)}</span></div>}
        {row.boxDays > 0 && <div className="between"><span className="muted">Box sofőrként (1. kör)</span><span>{row.boxDays} nap · {formatHuf(row.boxPay)}</span></div>}
        {row.boxRound2Days > 0 && <div className="between"><span className="muted">Box 2. körök</span><span>{row.boxRound2Days} db · {formatHuf(row.boxRound2Pay)}</span></div>}
        {row.boxTraineeDays > 0 && <div className="between"><span className="muted">Box betanulóként</span><span>{row.boxTraineeDays} nap · {formatHuf(row.boxTraineePay)}</span></div>}
        {row.traineeDays > 0 && <div className="between"><span className="muted">XL betanulóként</span><span>{row.traineeDays} nap · {formatHuf(row.traineePay)}</span></div>}
        <div className="between"><span className="muted">Ledolgozott nap</span><span>{row.days}</span></div>
        <div className="between"><span className="muted">Alapbér</span><span>{formatHuf(row.base)}</span></div>
        <div className="between"><span className="muted">Előleg</span><span style={{ color: row.advances > 0 ? 'var(--warning)' : undefined }}>{row.advances > 0 ? '−' : ''}{formatHuf(row.advances)}</span></div>
        <div className="between"><span className="muted">Levonás</span><span style={{ color: row.deductions > 0 ? 'var(--danger)' : undefined }}>{row.deductions > 0 ? '−' : ''}{formatHuf(row.deductions)}</span></div>
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

      <button className="btn secondary sm" onClick={() => openPayslip(row, ym)}><Icon name="file-text" />Bérlap (nyomtatás / PDF)</button>
    </div>
  )
}
