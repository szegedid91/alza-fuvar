import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { monthRange } from '../lib/payroll'
import { monthTitle } from '../lib/calendar'
import { formatHuf } from '../lib/labels'
import { resolveNames } from '../lib/names'
import { errMsg } from '../lib/errors'
import { matchXlCells, parseXlSheet, type XlMatch, type XlShiftLike, type XlUnmatched } from '../lib/xlResults'
import Icon from './Icon'

const WD = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo']
const dayLabel = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}. ${WD[new Date(y, m - 1, d).getDay()]}` }

type XlDay = XlShiftLike & { key: string }

// Az XL (nem Box) beosztások egy időszakban, nevekkel — autónként és naponként egy sor
async function loadXlDays(ws: string, from: string, toExclusive: string): Promise<XlDay[]> {
  const { data, error } = await supabase.from('shifts')
    .select('work_date, car_id, driver_id, loader_id, trainee_id, is_box, car:cars(plate, category:car_categories(box_sheet))')
    .eq('workspace_id', ws).gte('work_date', from).lt('work_date', toExclusive).order('work_date')
  if (error) throw error
  const xl = (data ?? []).filter((s) => {
    const car = s.car as unknown as { plate: string; category: { box_sheet: boolean } | null } | null
    return !(s.is_box ?? !!car?.category?.box_sheet) && !!(s.driver_id || s.loader_id)
  })
  const names = await resolveNames(xl.flatMap((s) => [s.driver_id, s.loader_id, s.trainee_id]))
  const byKey = new Map<string, XlDay>()
  for (const s of xl) {
    const key = `${s.car_id}|${s.work_date}`
    if (byKey.has(key)) continue
    const plate = (s.car as unknown as { plate: string } | null)?.plate ?? '?'
    byKey.set(key, {
      key, work_date: s.work_date, car_id: s.car_id, plate,
      people: [
        { id: s.driver_id, name: s.driver_id ? names[s.driver_id] ?? null : null, driver: true },
        { id: s.loader_id, name: s.loader_id ? names[s.loader_id] ?? null : null, driver: false },
        { id: s.trainee_id, name: s.trainee_id ? names[s.trainee_id] ?? null : null, driver: false },
      ].filter((p) => !!p.id),
    })
  }
  return [...byKey.values()].sort((a, b) => a.work_date.localeCompare(b.work_date) || a.plate.localeCompare(b.plate))
}

interface Preview { fileName: string; matched: XlMatch[]; unmatched: XlUnmatched[]; problems: string[] }

// XL sikeres címek: az autók napi címszáma — ebből jár az XL sikerdíj (a napidíjaknál beállított küszöb felett).
// Feltölthető a megbízó havi táblázatából (a sorokat a beosztás nevei alapján párosítjuk az autókhoz), és kézzel is írható.
export default function XlResultsCard({ ym, rates }: { ym: string; rates: { id: string; xlBonusOver: number; xlBonus: number }[] }) {
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const qc = useQueryClient()
  const range = useMemo(() => monthRange(ym), [ym])
  const rate = rates.find((r) => r.id === currentWorkspaceId)
  const over = rate?.xlBonusOver ?? 0
  const bonus = rate?.xlBonus ?? 0
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: days } = useQuery({
    queryKey: ['xl-days', currentWorkspaceId, ym],
    enabled: !!currentWorkspaceId,
    queryFn: () => loadXlDays(currentWorkspaceId!, range.start, range.endExclusive),
  })
  const { data: results } = useQuery({
    queryKey: ['xl-results', currentWorkspaceId, ym],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('xl_day_results').select('car_id, work_date, success_count, note, route_code, source')
        .eq('workspace_id', currentWorkspaceId!).gte('work_date', range.start).lt('work_date', range.endExclusive)
      if (error) throw error
      return data ?? []
    },
  })
  const resultOf = useMemo(() => new Map((results ?? []).map((r) => [`${r.car_id}|${r.work_date}`, r])), [results])
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['xl-results'] })
    await qc.invalidateQueries({ queryKey: ['payroll'] })
  }

  // Kézi beírás: a mezőből kilépve ment; üresre törölve a nap adata törlődik
  const saveOne = useMutation({
    mutationFn: async ({ day, text }: { day: XlDay; text: string }) => {
      const t = text.trim()
      if (!t) {
        const { error } = await supabase.from('xl_day_results').delete().eq('car_id', day.car_id).eq('work_date', day.work_date)
        if (error) throw error
        return
      }
      const n = Number(t)
      if (!Number.isInteger(n) || n < 0 || n > 999) throw new Error('A címszám egész szám legyen (0–999).')
      const { error } = await supabase.from('xl_day_results').upsert(
        { workspace_id: currentWorkspaceId!, work_date: day.work_date, car_id: day.car_id, success_count: n, source: 'manual' },
        { onConflict: 'car_id,work_date' })
      if (error) throw error
    },
    onSuccess: async (_d, v) => { setErr(null); await refresh(); setDrafts((p) => { const n = { ...p }; delete n[v.day.key]; return n }) },
    onError: (e) => setErr(errMsg(e, 'A mentés nem sikerült')),
  })

  async function pick(file: File) {
    if (!currentWorkspaceId) return
    setErr(null); setSavedMsg(null); setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const cells = []; const problems: string[] = []
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true }) as unknown[][]
        const p = parseXlSheet(rows)
        cells.push(...p.cells)
        // ha több lap van, a „nincs fejléc” csak akkor hiba, ha egyik lapon sincs adat
        problems.push(...p.problems.map((x) => (wb.SheetNames.length > 1 ? `${name}: ${x}` : x)))
      }
      if (cells.length === 0) throw new Error(problems[0] ?? 'A táblázatban nem találok címszámot.')
      const dates = cells.map((c) => c.date).sort()
      const [y, m, d] = dates[dates.length - 1].split('-').map(Number)
      const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
      const shifts = await loadXlDays(currentWorkspaceId, dates[0], next)
      const { matched, unmatched } = matchXlCells(cells, shifts)
      setPreview({ fileName: file.name, matched, unmatched, problems: cells.length ? problems.filter((x) => !/fejlécet|„Cím” oszlopot/.test(x)) : problems })
      setOpen(true)
    } catch (e) { setErr(errMsg(e, 'A fájl nem olvasható')) }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const apply = useMutation({
    mutationFn: async () => {
      if (!preview || !currentWorkspaceId) return 0
      const rows = preview.matched.map((m) => ({
        workspace_id: currentWorkspaceId, work_date: m.cell.date, car_id: m.car_id, success_count: m.cell.count,
        source: 'import', route_code: m.cell.route, note: m.cell.note,
      }))
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from('xl_day_results').upsert(rows.slice(i, i + 200), { onConflict: 'car_id,work_date' })
        if (error) throw error
      }
      return rows.length
    },
    onSuccess: async (n) => { setErr(null); setSavedMsg(`${n} nap címszáma elmentve.`); setPreview(null); await refresh() },
    onError: (e) => setErr(errMsg(e, 'A mentés nem sikerült')),
  })

  if (!currentWorkspaceId) return null
  const list = days ?? []
  const filled = list.filter((d) => resultOf.has(d.key)).length
  const bonusDays = bonus > 0 ? list.filter((d) => (resultOf.get(d.key)?.success_count ?? -1) > over).length : 0

  return (
    <div className="card stack">
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}><Icon name="trending-up" />XL sikeres címek — {monthTitle(ym)}</div>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Olvasás…' : 'Feltöltés táblázatból'}</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f) }} />
        </div>
      </div>
      <div className="tiny muted">
        {currentWorkspace?.name ? `${currentWorkspace.name} · ` : ''}
        {bonus > 0
          ? <>Sikerdíj: <strong>{over} cím felett +{formatHuf(bonus)}</strong> naponta, a sofőrnek és a rakodónak is.</>
          : <>A sikerdíj nincs beállítva — a Napidíjak kártyán, az „Emelés hónaptól” alatt adható meg a küszöb és az összeg.</>}
        {' '}A megbízó havi táblázatából („ALZA_UTÓD…xlsx”) tölthető fel: a sorokat a beosztásban szereplő nevek alapján párosítjuk az autókhoz.
      </div>
      {err && <div className="alert error">{err}</div>}
      {savedMsg && <div className="alert success">{savedMsg}</div>}

      {preview && (
        <div className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div className="small" style={{ fontWeight: 700 }}>{preview.fileName} · {preview.matched.length} nap párosítva{preview.unmatched.length > 0 ? ` · ${preview.unmatched.length} nem párosítható` : ''}</div>
          {preview.matched.some((m) => m.partial) && (
            <div className="tiny muted">A <strong>*</strong> jelű soroknál a táblázat párosa nem egyezik teljesen a beosztással (a sofőr vagy az egyik név alapján párosítva).</div>
          )}
          <div className="stack" style={{ gap: 1, maxHeight: 260, overflowY: 'auto' }}>
            {preview.matched.map((m, i) => (
              <div key={i} className="between tiny" style={{ gap: 8 }}>
                <span>{dayLabel(m.cell.date)} · <strong>{m.plate}</strong>{m.partial ? ' *' : ''} <span className="muted">· {m.cell.route} · {m.cell.names.join(' / ')}{m.cell.note ? ` · ${m.cell.note}` : ''}</span></span>
                <span className="num" style={{ fontWeight: 700, color: bonus > 0 && m.cell.count > over ? 'var(--success)' : undefined }}>{m.cell.count}</span>
              </div>
            ))}
          </div>
          {preview.unmatched.length > 0 && (
            <div className="alert warning tiny stack" style={{ gap: 2 }}>
              <strong>Ezek a sorok kimaradnak — a beosztás javítása után töltsd fel újra, vagy írd be kézzel:</strong>
              {preview.unmatched.map((u, i) => (
                <span key={i}>{dayLabel(u.cell.date)} · {u.cell.route} · {u.cell.names.join(' / ') || '—'} · {u.cell.count} cím — {u.reason}</span>
              ))}
            </div>
          )}
          {preview.problems.length > 0 && (
            <div className="alert warning tiny stack" style={{ gap: 2 }}>{preview.problems.slice(0, 8).map((p, i) => <span key={i}>{p}</span>)}</div>
          )}
          <div className="btn-grid">
            <button type="button" className="btn sm" disabled={apply.isPending || preview.matched.length === 0} onClick={() => apply.mutate()}>
              {apply.isPending ? 'Mentés…' : `Mentés (${preview.matched.length} nap)`}
            </button>
            <button type="button" className="btn ghost sm" disabled={apply.isPending} onClick={() => setPreview(null)}>Mégse</button>
          </div>
        </div>
      )}

      <button type="button" className="btn ghost sm" onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} />
        {list.length === 0 ? 'Ebben a hónapban nincs XL beosztás' : `${list.length} XL nap · ${filled} kitöltve${bonus > 0 ? ` · ${bonusDays} sikerdíjas` : ''}`}
      </button>
      {open && list.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          {list.map((d) => {
            const r = resultOf.get(d.key)
            const text = drafts[d.key] ?? (r ? String(r.success_count) : '')
            const earns = bonus > 0 && r != null && r.success_count > over
            return (
              <div key={d.key} className="between small" style={{ gap: 8, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ minWidth: 0 }}>
                  {dayLabel(d.work_date)} · <strong>{d.plate}</strong>
                  <span className="muted"> · {d.people.map((p) => p.name ?? '?').join(' / ')}{r?.route_code ? ` · ${r.route_code}` : ''}{r?.note ? ` · ${r.note}` : ''}</span>
                </span>
                <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                  {earns && <span className="badge primary">sikerdíj</span>}
                  <input className="input" inputMode="numeric" value={text} placeholder="—" aria-label={`Sikeres címek: ${d.plate} ${d.work_date}`}
                    style={{ width: 64, minHeight: 32, height: 32, textAlign: 'right', padding: '0 8px' }}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setDrafts((p) => ({ ...p, [d.key]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    onBlur={() => { if (drafts[d.key] != null && drafts[d.key].trim() !== (r ? String(r.success_count) : '')) saveOne.mutate({ day: d, text: drafts[d.key] }) }} />
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
