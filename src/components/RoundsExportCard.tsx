import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useWorkspace } from '../context/WorkspaceContext'
import { monthRange } from '../lib/payroll'
import { monthTitle } from '../lib/calendar'
import { buildRoundsTable, exportRoundsXlsx, type RoundShift } from '../lib/roundsExport'
import { toast } from '../lib/toast'
import { errMsg } from '../lib/errors'
import Icon from './Icon'

const PREFIX_KEY = 'alza-rounds-prefix'

// Napi járatszám a megbízó táblájának formátumában: útvonalanként, naponként
// DPO db (éjszakai indulás = 1. kör) és SD db (same day, 5:30-as indulás = 2. kör).
// Forrás: a beosztás járatos sorai (ki melyik járatot melyik körben vitte).
export default function RoundsExportCard({ ym }: { ym: string }) {
  const { currentWorkspaceId } = useWorkspace()
  const [prefix, setPrefix] = useState(() => { try { return localStorage.getItem(PREFIX_KEY) ?? 'Budapest' } catch { return 'Budapest' } })
  const [busy, setBusy] = useState(false)
  const range = useMemo(() => monthRange(ym), [ym])

  const { data, isError, error } = useQuery({
    queryKey: ['rounds-export', currentWorkspaceId, ym],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const ws = currentWorkspaceId!
      const [routesRes, shifts] = await Promise.all([
        supabase.from('route_names').select('id, code, active, is_relief').eq('workspace_id', ws),
        fetchAll((f, t) => supabase.from('shifts').select('work_date, round, route_id, driver_id, loader_id, car:cars(category:car_categories(box_sheet))')
          .eq('workspace_id', ws).gte('work_date', range.start).lt('work_date', range.endExclusive).order('id').range(f, t)),
      ])
      if (routesRes.error) throw routesRes.error
      const rows: RoundShift[] = (shifts ?? []).map((s) => ({
        work_date: s.work_date, round: s.round, route_id: s.route_id,
        staffed: !!(s.driver_id || s.loader_id),
        isBox: !!(s.car as unknown as { category: { box_sheet: boolean } | null } | null)?.category?.box_sheet,
      }))
      return { routes: routesRes.data ?? [], shifts: rows }
    },
  })

  const table = useMemo(() => (data ? buildRoundsTable(ym, data.routes, data.shifts, prefix) : null), [data, ym, prefix])
  const hasRounds = !!table && table.dpoTotal + table.sdTotal > 0

  function changePrefix(v: string) {
    setPrefix(v)
    try { localStorage.setItem(PREFIX_KEY, v) } catch { /* privát mód: csak erre a megnyitásra szól */ }
  }

  async function download() {
    if (!table) return
    setBusy(true)
    try { await exportRoundsXlsx(table, `jaratszam_${ym}.xlsx`) }
    catch (e) { toast.error('Az export nem sikerült: ' + errMsg(e, 'ismeretlen hiba')) }
    finally { setBusy(false) }
  }

  return (
    <div className="card stack">
      <div className="card-title" style={{ margin: 0 }}><Icon name="map" />Napi járatszám — {monthTitle(ym)}</div>
      <p className="tiny muted" style={{ margin: 0 }}>
        Útvonalanként és naponként hány kör ment: <strong>DPO</strong> = 1. kör (éjszakai indulás), <strong>SD</strong> = 2. kör (same day, 5:30-as indulás).
        A beosztás járatos soraiból számol; a letöltött Excel a megbízó táblájának elrendezését követi (km nélkül).
      </p>
      {isError && <div className="alert error">A járatszám nem tölthető be: {errMsg(error, 'ismeretlen hiba')}</div>}
      {!data && !isError && <div className="tiny muted">Betöltés…</div>}
      {table && !hasRounds && <div className="tiny muted">Ebben a hónapban nincs járatos beosztás.</div>}
      {table && hasRounds && (
        <div>
          <div className="between tiny muted" style={{ padding: '2px 0' }}><span>Útvonal</span><span>DPO db · SD db</span></div>
          {table.rows.map((r) => (
            <div key={r.label} className="between small" style={{ padding: '3px 0' }}>
              <span>{r.label}</span><span className="num">{r.dpoTotal} · {r.sdTotal}</span>
            </div>
          ))}
          <div className="between small" style={{ padding: '5px 0 0', borderTop: '1px solid var(--border)', fontWeight: 700 }}>
            <span>Összesen</span><span className="num">{table.dpoTotal} · {table.sdTotal}</span>
          </div>
        </div>
      )}
      <div className="field">
        <label>Útvonalnév előtagja a táblában</label>
        <input className="input" value={prefix} maxLength={30} onChange={(e) => changePrefix(e.target.value)} placeholder="pl. Budapest" />
        <div className="tiny muted">A sorok neve: „{prefix.trim() ? `${prefix.trim()} G` : 'G'}”. Üresen hagyva csak a járat betűjele.</div>
      </div>
      <button className="btn secondary sm" disabled={!hasRounds || busy} onClick={() => void download()}>
        <Icon name="file-text" />{busy ? 'Készül…' : 'Járatszám-tábla letöltése (Excel)'}
      </button>
    </div>
  )
}
