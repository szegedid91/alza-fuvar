import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useMembers } from '../hooks/useMembers'
import { todayISO, formatDate, formatHuf, adjustmentTypeLabel, parseHuNumber, isCrewRole } from '../lib/labels'
import { resolveNames } from '../lib/names'
import { sumAdvances, monthRange, buildDayComps, payForDay, rateSetOf, advanceCoverage, advanceLimitError } from '../lib/payroll'
import { monthTitle } from '../lib/calendar'
import ConfirmButton from '../components/ConfirmButton'
import type { Enums } from '../lib/database.types'
import { toast } from '../lib/toast'
import Icon from '../components/Icon'
import { errMsg } from '../lib/errors'

// Gyakori összegek egy koppintásra (készpénzes előleg)
const QUICK_AMOUNTS = [5000, 10000, 20000, 50000]

const RATE_COLS = 'driver_day_rate, loader_day_rate, trainee_day_rate, box_day_rate, box_trainee_day_rate, box_round2_day_rate'
const WEEKDAYS = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo']
// '2026-11-03' → '11.03. K' (rövid nap-címke a kijelölő gombokra és a tétel-listába)
function shortDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}. ${WEEKDAYS[new Date(y, m - 1, d).getDay()]}`
}

export default function Adjustments() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const qc = useQueryClient()
  const { data: members } = useMembers()

  const [userId, setUserId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<Enums<'adjustment_type'>>('advance')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Előlegnél: mely ledolgozott napokat fizeti ki ez a tétel (több is jelölhető)
  const [selDays, setSelDays] = useState<string[]>([])
  // A lista alapból a kiválasztott munkatársra szűr (előleg rögzítésekor
  // látszik, mennyit vett fel eddig a hónapban) — egy koppintással az összes
  const [showAll, setShowAll] = useState(false)

  // Csak munkatársnak van napidíjas bére — a vezetők nem kaphatnak előleget/levonást itt
  const crew = (members ?? []).filter((m) => isCrewRole(m.role))

  const { data: list } = useQuery({
    queryKey: ['adjustments', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('adjustments')
        .select('*, user:profiles!adjustments_user_id_fkey(full_name)')
        .eq('workspace_id', currentWorkspaceId!)
        .order('work_date', { ascending: false }).order('created_at', { ascending: false }).limit(60)
      if (error) throw error
      const rows = data ?? []
      // Ki rögzítette — a profiles-t a névfeloldó RPC-n át (csak nevek)
      const names = await resolveNames(rows.map((r) => r.created_by))
      return rows.map((r) => ({ ...r, _by: r.created_by ? names[r.created_by] ?? null : null }))
    },
  })

  // LOG-10: a kiválasztott munkatárs HAVI tételei külön, korlát nélkül — a 60-as listából
  // kieshettek a korábbi e havi előlegei, és a vezető túl alacsony összeget látott.
  // A hónap a tétel dátumának hónapja (alapból a mai nap → az aktuális hónap).
  const ym = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : todayISO().slice(0, 7)
  const { data: monthRows } = useQuery({
    queryKey: ['adjustments', 'month', currentWorkspaceId, userId, ym],
    enabled: !!currentWorkspaceId && !!userId,
    queryFn: async () => {
      const { start, endExclusive } = monthRange(ym)
      const { data, error } = await supabase.from('adjustments').select('type, amount, work_date, covered_dates')
        .eq('workspace_id', currentWorkspaceId!).eq('user_id', userId).gte('work_date', start).lt('work_date', endExclusive)
      if (error) throw error
      return data ?? []
    },
  })

  // A kiválasztott munkatárs ledolgozott napjai a hónapban (becsekkolásból) a napi díjukkal —
  // ugyanazzal a számítással, mint a Bérszámítás (szerep a beosztásból, a hónapra érvényes napidíj)
  const { data: worked, isError: workedError } = useQuery({
    queryKey: ['adjustments', 'worked', currentWorkspaceId, userId, ym],
    enabled: !!currentWorkspaceId && !!userId,
    queryFn: async () => {
      const { start, endExclusive } = monthRange(ym)
      const [ci, sh, ws, hist] = await Promise.all([
        supabase.from('check_ins').select('work_date')
          .eq('workspace_id', currentWorkspaceId!).eq('user_id', userId).gte('work_date', start).lt('work_date', endExclusive),
        supabase.from('shifts').select('driver_id, loader_id, trainee_id, work_date, round, car:cars(category:car_categories(box_sheet))')
          .or(`driver_id.eq.${userId},loader_id.eq.${userId},trainee_id.eq.${userId}`).gte('work_date', start).lt('work_date', endExclusive),
        supabase.from('workspaces').select(RATE_COLS).eq('id', currentWorkspaceId!).maybeSingle(),
        supabase.from('workspace_rate_history').select(RATE_COLS)
          .eq('workspace_id', currentWorkspaceId!).lte('valid_from', start).order('valid_from', { ascending: false }).limit(1),
      ])
      for (const r of [ci, sh, ws, hist]) if (r.error) throw r.error
      const rate = hist.data?.[0] ? rateSetOf(hist.data[0]) : ws.data ? rateSetOf(ws.data) : undefined
      const comps = buildDayComps(sh.data ?? [])
      const dates = [...new Set((ci.data ?? []).map((c) => c.work_date))].sort()
      return dates.map((d) => { const p = payForDay(comps.get(`${userId}|${d}`), rate); return { date: d, rate: p.rate, label: p.label } })
    },
  })
  const coverage = worked ? advanceCoverage(worked, monthRows ?? []) : null

  // Másik munkatárs / hónap / típus → a nap-kijelölés nem vihető át
  useEffect(() => { setSelDays([]) }, [userId, ym, type])

  // Nap ki-/bejelölése: az összeg a kijelölt napok díja (de legfeljebb a még adható előleg —
  // így a korábbi, nap-megjelölés nélküli előleg is „ráilleszthető” a napokra)
  function applyDays(next: string[]) {
    setSelDays(next)
    setError(null)
    const sum = (worked ?? []).filter((w) => next.includes(w.date)).reduce((x, w) => x + w.rate, 0)
    if (next.length === 0) setAmount('')
    else if (sum > 0) setAmount(String(coverage && coverage.workedValue > 0 ? Math.min(sum, coverage.remaining) : sum))
  }
  const toggleDay = (d: string) => applyDays(selDays.includes(d) ? selDays.filter((x) => x !== d) : [...selDays, d])

  // Téves tétel törlése (zárolt hónapban a trigger tiltja — a hibát mutatjuk)
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('adjustments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Tétel törölve.'); void qc.invalidateQueries({ queryKey: ['adjustments'] }) },
    onError: (e) => toast.error('Nem törölhető: ' + (errMsg(e, 'ismeretlen hiba'))),
  })

  const add = useMutation({
    mutationFn: async () => {
      const amt = parseHuNumber(amount)
      // Negatív előleg/levonás fordítva hatna a bérre — csak pozitív összeg mehet
      if (!Number.isFinite(amt) || amt <= 0) throw new Error('Érvénytelen összeg — pozitív számot adj meg.')
      // LOG-24: üres vagy jövőbeli dátum nem mehet (jövő hónapba könyvelt előleg)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayISO()) throw new Error('Érvénytelen dátum — mai vagy korábbi napot adj meg.')
      // Előleg legfeljebb a már ledolgozott, még ki nem fizetett napok értékéig adható
      if (type === 'advance') {
        if (!coverage) throw new Error('A ledolgozott napok még nem töltődtek be — próbáld újra.')
        const limit = advanceLimitError(amt, coverage, formatHuf)
        if (limit) throw new Error(limit)
      }
      const { error } = await supabase.from('adjustments').insert({
        workspace_id: currentWorkspaceId!, user_id: userId, work_date: date,
        amount: amt,
        type, reason: reason.trim() || null, created_by: profile!.id,
        covered_dates: type === 'advance' && selDays.length > 0 ? [...selDays].sort() : null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      const who = members?.find((m) => m.id === userId)
      toast.success(`${type === 'advance' ? 'Előleg' : 'Levonás'} rögzítve${who ? ` — ${who.full_name || who.email}` : ''}`)
      setAmount(''); setReason(''); setError(null); setSelDays([])
      void qc.invalidateQueries({ queryKey: ['adjustments'] })
    },
    onError: (e) => setError(errMsg(e, 'Hiba')),
  })

  const canSave = !!userId && !!amount && !add.isPending && (type !== 'advance' || !!coverage)

  return (
    <div className="stack">
      <h2>Előleg / levonás — {currentWorkspace?.name}</h2>

      <div className="card stack primary">
        <div className="card-title" style={{ margin: 0 }}><Icon name="wallet" />Új tétel</div>
        <div className="field">
          <label>Munkatárs</label>
          <select className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">— válassz —</option>
            {crew.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Típus</label>
          {/* Két választás → kapcsoló, nem legördülő (egy koppintás, látszik mindkettő) */}
          <div className="tabs" style={{ margin: 0 }}>
            <button type="button" className={type === 'advance' ? 'active' : ''} onClick={() => setType('advance')}><Icon name="banknote" size={18} />Előleg</button>
            <button type="button" className={type === 'deduction' ? 'active' : ''} onClick={() => setType('deduction')}><Icon name="minus" size={18} />Levonás</button>
          </div>
          <div className="tiny muted">
            {type === 'advance'
              ? 'Előleg: a hónap közben felvett pénz — a bérlapon nem látszik, a kifizetéskor számolódik el.'
              : 'Levonás: a bérből levont összeg (pl. kár) — a bérlapon indokkal szerepel.'}
          </div>
        </div>
        {userId && type === 'advance' && (
          <div className="field">
            <label>Ledolgozott napok — {monthTitle(ym)}</label>
            {workedError && <div className="alert error">A ledolgozott napok nem tölthetők be — előleg most nem rögzíthető.</div>}
            {!workedError && !coverage && <div className="tiny muted">Betöltés…</div>}
            {coverage && coverage.workedCount === 0 && <div className="tiny muted">Ebben a hónapban még nincs ledolgozott (becsekkolt) napja.</div>}
            {coverage && coverage.workedCount > 0 && (
              <>
                <div className="between small">
                  <span><strong style={{ fontSize: 18 }}>{coverage.percent}%</strong> kifizetve előlegként</span>
                  <span className="muted">{coverage.workedValue > 0 ? `${formatHuf(coverage.advanced)} / ${formatHuf(coverage.workedValue)}` : `${coverage.paidCount} / ${coverage.workedCount} nap`}</span>
                </div>
                <div className="progress" style={{ marginTop: 0 }}><div style={{ width: `${coverage.percent}%` }} /></div>
                <div className="tiny muted">
                  {coverage.paidCount} / {coverage.workedCount} nap megjelölve fizetettnek
                  {coverage.workedValue > 0 ? <> · még adható: <strong>{formatHuf(coverage.remaining)}</strong></> : ' · nincs beállított napidíj'}
                </div>
                <div className="chips">
                  {(worked ?? []).map((w) => {
                    const paid = coverage.paidDates.has(w.date)
                    const sel = selDays.includes(w.date)
                    return (
                      <button key={w.date} type="button" disabled={paid} aria-pressed={sel}
                        className={`chip day-chip ${sel ? 'active' : ''} ${paid ? 'paid' : ''}`}
                        title={paid ? `${w.label} — már kifizetve` : w.label}
                        onClick={() => toggleDay(w.date)}>
                        {paid && <Icon name="check" size={16} />}
                        <span>{shortDay(w.date)}</span>
                        <span className="day-chip-sub">{paid ? 'fizetve' : w.rate > 0 ? formatHuf(w.rate) : w.label}</span>
                      </button>
                    )
                  })}
                </div>
                {(() => {
                  const unpaid = (worked ?? []).filter((w) => !coverage.paidDates.has(w.date)).map((w) => w.date)
                  if (unpaid.length === 0) return <div className="tiny muted">Minden ledolgozott napja meg van jelölve fizetettnek.</div>
                  return (
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" className="link-btn" style={{ width: 'auto', fontSize: 13, padding: '6px 8px' }} onClick={() => applyDays(unpaid)}>
                        Mind kijelölése ({unpaid.length} nap)
                      </button>
                      {selDays.length > 0 && (
                        <button type="button" className="link-btn" style={{ width: 'auto', fontSize: 13, padding: '6px 8px' }} onClick={() => applyDays([])}>
                          Kijelölés törlése
                        </button>
                      )}
                    </div>
                  )
                })()}
                <div className="tiny muted">
                  {selDays.length > 0
                    ? `${selDays.length} nap kijelölve — rögzítés után ezek fizetettnek számítanak.`
                    : 'Koppints azokra a napokra, amelyeket ezzel az előleggel kifizetsz — az összeg magától kitöltődik.'}
                </div>
              </>
            )}
          </div>
        )}
        <div className="field">
          <label>Összeg (Ft)</label>
          <input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10 000" />
          <div className="chips">
            {QUICK_AMOUNTS.map((q) => (
              <button key={q} type="button" className="chip" style={{ minHeight: 34, padding: '4px 10px' }} onClick={() => setAmount(String(q))}>
                {formatHuf(q)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Dátum</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Indok</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="pl. előleg készpénzben" />
        </div>
        {error && <div className="alert error">{error}</div>}
        {/* Bért érintő művelet — két koppintás, mint a többi véglegesítésnél */}
        <ConfirmButton className="btn" confirmLabel={`Biztos? ${type === 'advance' ? 'Előleg' : 'Levonás'} rögzítése`} disabled={!canSave} onConfirm={() => add.mutate()}>
          <Icon name="check" />{add.isPending ? 'Mentés…' : 'Rögzítés'}
        </ConfirmButton>
      </div>

      {(() => {
        const all = list ?? []
        const selected = userId && !showAll ? crew.find((m) => m.id === userId) : null
        const shown = selected ? all.filter((a) => a.user_id === userId) : all
        // A kiválasztott munkatárs e havi előlege — rögzítés előtt jó látni (teljes havi lista, LOG-10)
        const monthAdv = selected ? sumAdvances(monthRows ?? [], ym) : 0
        if (all.length === 0) return null
        return (
          <div className="card stack">
            <div className="between">
              <div className="card-title" style={{ margin: 0 }}><Icon name="history" />{selected ? 'Tételei' : 'Legutóbbi tételek'}</div>
              {userId && (
                <button className="link-btn" type="button" style={{ width: 'auto', fontSize: 13, padding: '6px 8px' }} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Csak a kiválasztott' : 'Összes munkatárs'}
                </button>
              )}
            </div>
            {selected && (
              <div className="tiny muted">
                {selected.full_name || selected.email} · {monthTitle(ym)}: felvett előleg <strong>{formatHuf(monthAdv)}</strong>
                {coverage && coverage.workedCount > 0 && <> · a ledolgozott napok <strong>{coverage.percent}%</strong>-a kifizetve</>}
              </div>
            )}
            {shown.length === 0 && <div className="tiny muted">Nincs rögzített tétel ennél a munkatársnál.</div>}
            {shown.map((a) => (
              <div key={a.id} className="between" style={{ gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 600 }}>{(a.user as unknown as { full_name: string | null } | null)?.full_name ?? 'Ismeretlen'}</div>
                  <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatDate(a.work_date)}{a.reason ? ` · ${a.reason}` : ''}{a._by ? ` · ${a._by}` : ''}
                  </div>
                  {a.covered_dates && a.covered_dates.length > 0 && (
                    <div className="tiny muted">Fizetett napok ({a.covered_dates.length}): {a.covered_dates.map(shortDay).join(', ')}</div>
                  )}
                </div>
                <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                  <span className={`badge ${a.type === 'advance' ? 'money' : 'danger'}`}>
                    {a.type === 'deduction' ? '−' : ''}{formatHuf(Number(a.amount))}
                    <span className="muted" style={{ fontWeight: 500 }}>{adjustmentTypeLabel[a.type].toLowerCase()}</span>
                  </span>
                  <ConfirmButton className="btn ghost sm" confirmLabel="Törlés?" title="Tétel törlése" disabled={remove.isPending}
                    style={{ minHeight: 34, padding: '4px 8px' }}
                    onConfirm={() => remove.mutate(a.id)}>
                    <Icon name="trash" size={16} />
                  </ConfirmButton>
                </div>
              </div>
            ))}
          </div>
        )
      })()}
    </div>
  )
}
