import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { todayISO } from '../lib/labels'
import { addDays, buildQualityReport, exportQualityXlsx, huDate, localAt, type QBlock, type QEvent, type QSheet, type QShift, type QStop } from '../lib/qualityReport'
import { toast } from '../lib/toast'
import { errMsg } from '../lib/errors'
import Icon from './Icon'

const PREFIX_KEY = 'alza-rounds-prefix' // közös a járatszám-exporttal
const COMPANY_KEY = 'alza-quality-company'
const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const save = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* privát mód: csak erre a megnyitásra szól */ } }

// Napi minőségjelentés a megbízónak: éjszakai járat (előző este 23:59) + nappali járat (5:30),
// útvonalanként indulás / járat vége / komplikációk / darabszámok — a megbízó Excel-mintája szerint.
export default function QualityReportCard() {
  const { currentWorkspaceId } = useWorkspace()
  const [day, setDay] = useState(() => todayISO())
  const [company, setCompany] = useState(() => read(COMPANY_KEY, 'Utód zrt.'))
  const [prefix, setPrefix] = useState(() => read(PREFIX_KEY, 'Budapest'))
  const [busy, setBusy] = useState(false)
  const eve = addDays(day, -1)
  const lastDay = addDays(todayISO(), 1) // a ma esti éjszakai járat már a holnapi jelentésbe tartozik

  const { data, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['quality-report', currentWorkspaceId, day],
    enabled: !!currentWorkspaceId && /^\d{4}-\d{2}-\d{2}$/.test(day),
    queryFn: async () => {
      const ws = currentWorkspaceId!
      const [routesRes, shiftsRes] = await Promise.all([
        supabase.from('route_names').select('id, code, active, is_relief').eq('workspace_id', ws),
        supabase.from('shifts').select('work_date, round, route_id, driver_id, loader_id').eq('workspace_id', ws).gte('work_date', eve).lte('work_date', day),
      ])
      if (routesRes.error) throw routesRes.error
      if (shiftsRes.error) throw shiftsRes.error
      const shifts = (shiftsRes.data ?? []) as QShift[]
      const users = [...new Set(shifts.flatMap((s) => [s.driver_id, s.loader_id]).filter((x): x is string => !!x))]
      let events: QEvent[] = []; let sheets: QSheet[] = []; let stops: QStop[] = []
      if (users.length) {
        // az éjszakai kör átnyúlik a következő naptári napra → időre szűrünk, nem munkanapra
        const from = new Date(localAt(eve, '00:00')).toISOString()
        const to = new Date(localAt(addDays(day, 2), '00:00')).toISOString()
        const [evRes, shRes] = await Promise.all([
          supabase.from('status_events').select('user_id, kind, at, note').eq('workspace_id', ws).in('user_id', users)
            .in('kind', ['departed', 'done', 'settled', 'issue']).gte('at', from).lt('at', to).order('at').limit(2000),
          supabase.from('box_sheets').select('id, user_id, created_at, end_time, comp_bu, comp_szh, comp_hb, comp_r, comp_note, wh_crates_no_label, wh_packages_no_label, wh_pallet_items, wh_note, stops:box_sheet_stops(sheet_id, done_at, created_at, box_code, box_name, note, missorted, nf, oversize, shortage, returned, damaged, left_on_car)')
            .eq('workspace_id', ws).in('user_id', users).gte('work_date', eve).lte('work_date', addDays(day, 1)),
        ])
        if (evRes.error) throw evRes.error
        if (shRes.error) throw shRes.error
        events = (evRes.data ?? []) as QEvent[]
        const rows = (shRes.data ?? []) as unknown as (QSheet & { stops: QStop[] | null })[]
        sheets = rows.map(({ stops: _s, ...rest }) => rest as QSheet)
        stops = rows.flatMap((r) => r.stops ?? [])
      }
      return { routes: routesRes.data ?? [], shifts, events, sheets, stops }
    },
  })

  const report = useMemo(() => (data ? buildQualityReport(day, data.routes, data.shifts, data.events, data.sheets, data.stops, prefix) : null), [data, day, prefix])
  const hasRows = !!report && report.night.rows.length + report.dayBlock.rows.length > 0

  async function download() {
    if (!report) return
    setBusy(true)
    try { await exportQualityXlsx(report, company) }
    catch (e) { toast.error('Az export nem sikerült: ' + errMsg(e, 'ismeretlen hiba')) }
    finally { setBusy(false) }
  }

  return (
    <div className="card stack">
      <div className="card-title" style={{ margin: 0 }}><Icon name="file-text" />Napi minőségjelentés</div>
      <p className="tiny muted" style={{ margin: 0 }}>
        A megbízó táblája szerint: <strong>éjszakai járat</strong> (1. kör, előző este 23:59) és <strong>nappali járat</strong> (2. kör, 5:30).
        A valódi indulás a „Kiindultam”, az útvonal vége a „Járat kész” jelzésből jön, a darabszámok a Box-lapok megállóiból, az elszámolás ideje a megjegyzésbe kerül.
      </p>
      <div className="field">
        <label>A jelentés napja (a nappali járat napja)</label>
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn" aria-label="Előző nap" onClick={() => setDay(addDays(day, -1))}><Icon name="chevron-left" /></button>
          <input className="input" type="date" value={day} max={lastDay} onChange={(e) => { if (e.target.value) setDay(e.target.value) }} style={{ flex: 1 }} />
          <button className="icon-btn" aria-label="Következő nap" disabled={day >= lastDay} style={{ opacity: day >= lastDay ? 0.35 : 1 }} onClick={() => setDay(addDays(day, 1))}><Icon name="chevron-right" /></button>
        </div>
      </div>
      {isError && <div className="alert error">A jelentés adatai nem tölthetők be: {errMsg(error, 'ismeretlen hiba')}</div>}
      {!data && !isError && <div className="tiny muted">Betöltés…</div>}
      {report && <BlockPreview block={report.night} />}
      {report && <BlockPreview block={report.dayBlock} />}
      <div className="grid-2">
        <div className="field">
          <label>Cégnév a címben</label>
          <input className="input" value={company} maxLength={40} onChange={(e) => { setCompany(e.target.value); save(COMPANY_KEY, e.target.value) }} placeholder="pl. Utód zrt." />
        </div>
        <div className="field">
          <label>Útvonalnév előtagja</label>
          <input className="input" value={prefix} maxLength={30} onChange={(e) => { setPrefix(e.target.value); save(PREFIX_KEY, e.target.value) }} placeholder="pl. Budapest" />
        </div>
      </div>
      <div className="btn-grid">
        <button className="btn ghost sm" disabled={isFetching} onClick={() => void refetch()}><Icon name="refresh" />{isFetching ? 'Frissül…' : 'Adatok frissítése'}</button>
        <button className="btn secondary sm" disabled={!hasRows || busy} onClick={() => void download()}>
          <Icon name="file-text" />{busy ? 'Készül…' : 'Jelentés letöltése (Excel)'}
        </button>
      </div>
    </div>
  )
}

function BlockPreview({ block }: { block: QBlock }) {
  const cell = (v: string | number | null) => (v === null || v === '' ? '–' : v)
  return (
    <div>
      <div className="small" style={{ fontWeight: 700 }}>{huDate(block.date)} — {block.kind === 'night' ? 'éjszakai járat' : 'nappali járat'}</div>
      {block.rows.length === 0 && <div className="tiny muted">Nincs aktív útvonal.</div>}
      {block.rows.map((r) => (
        <div key={r.label} style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
          <div className="between small">
            <span style={{ fontWeight: 600 }}>{r.label}</span>
            {r.staffed
              ? <span className="num">{r.planned} → {cell(r.departed)} · vége {cell(r.ended)}{r.endedFromSheet ? '*' : ''} · elsz. {cell(r.settled)}</span>
              : <span className="tiny muted">nincs beosztás</span>}
          </div>
          {r.staffed && (
            <div className="tiny muted">
              {r.hasSheet
                ? <>rossz szort. {r.missorted} · nem fért be {r.noFit} · hiány {r.shortage} · visszáru {r.returned} · nem szállított {r.undelivered}</>
                : 'nincs Box-lap adat — a darabszámok üresen maradnak'}
              {r.complications && <div>Komplikáció: {r.complications.split('\n').join(' · ')}</div>}
            </div>
          )}
        </div>
      ))}
      {block.rows.some((r) => r.endedFromSheet) && <div className="tiny muted">* nincs „Járat kész” jelzés — a Box-lap végzési ideje</div>}
      {block.unrouted > 0 && <div className="alert info" style={{ marginTop: 6 }}>{block.unrouted} beosztásnak nincs járata erre a körre — ezek nem szerepelnek a jelentésben. A beosztás-szerkesztőben adj nekik járatot.</div>}
    </div>
  )
}
