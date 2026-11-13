import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useRoutes } from '../hooks/useRoutes'
import { useRouteStops } from '../hooks/useRouteStops'
import { parseRoutePlan, type PlanRoute } from '../lib/routePlan'
import { toast } from '../lib/toast'
import Icon from './Icon'
import { errMsg } from '../lib/errors'
import { Link } from 'react-router'
import { useAuth } from '../context/AuthContext'

type KnownBox = { id: string; code: string | null; lat: number | null; lng: number | null }
type Preview = { fileName: string; routes: PlanRoute[]; known: Map<string, KnownBox> }

// A csütörtöki járatterv (xlsx) betöltése: a járatok boxai és sorrendje a fájl
// szerint frissülnek, megállónként tervezett érkezéssel és határidővel. Az ismeretlen
// boxok bekerülnek a jegyzékbe. A mentesítő járatok érintetlenek maradnak.
export default function RoutePlanImport() {
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const { data: routes } = useRoutes()
  const { profile } = useAuth()
  const { data: stopsByRoute } = useRouteStops()
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function pick(file: File) {
    setErr(null); setBusy(true)
    try {
      const parsed = await parseRoutePlan(file)
      const codes = [...new Set(parsed.flatMap((r) => r.stops.map((s) => s.code)))]
      const bad = codes.filter((c) => !/^[A-Z0-9]{2,16}$/.test(c))
      if (bad.length) throw new Error(`Érvénytelen box-kód a fájlban: ${bad.slice(0, 5).join(', ')}`)
      // pontos kód, vagy a jegyzék utótagos változata (AB9759 → AB9759B), ha egyetlen ilyen van
      const { data, error } = await supabase.from('alza_boxes').select('id, code, lat, lng').or(codes.map((c) => `code.like."${c}%"`).join(','))
      if (error) throw error
      const known = new Map<string, KnownBox>()
      const rows = (data ?? []).filter((b): b is KnownBox & { code: string } => !!b.code)
      for (const c of codes) {
        const exact = rows.find((b) => b.code.toUpperCase() === c)
        if (exact) { known.set(c, exact); continue }
        const variants = rows.filter((b) => b.code.toUpperCase().startsWith(c))
        if (variants.length === 1) known.set(c, variants[0])
      }
      setPreview({ fileName: file.name, routes: parsed, known })
    } catch (e) { setErr(errMsg(e, 'A fájl nem olvasható')) }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const apply = useMutation({
    mutationFn: async () => {
      if (!preview || !currentWorkspaceId) return
      const ws = currentWorkspaceId
      // LOG-05: a járatlista a mutáción belül FRISSEN a szerverről — a komponens `routes` cache-e
      // egy félbeszakadt/ismételt importnál elavult (a már létrehozott kódot újra insertelné)
      const { data: existing, error: exErr } = await supabase.from('route_names').select('*').eq('workspace_id', ws)
      if (exErr) throw exErr
      const current = [...(existing ?? [])]
      let nextOrder = current.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0) + 1
      for (const pr of preview.routes) {
        // 1) járat (kód szerint), ha nincs, létrejön
        let route = current.find((r) => r.code.toUpperCase() === pr.code)
        if (!route) {
          const { data, error } = await supabase.from('route_names').insert({ workspace_id: ws, code: pr.code, sort_order: nextOrder++ }).select('*').single()
          if (error) throw error
          route = data
          current.push(data)
        }
        // 2) boxok: ismeretlen → új jegyzék-sor a fájl adataival; ismert, koordináta nélkül → koordináta pótlás
        const ids = new Map<string, string>()
        for (const s of pr.stops) {
          const k = preview.known.get(s.code)
          if (k) {
            ids.set(s.code, k.id)
            if ((k.lat == null || k.lng == null) && s.lat != null && s.lng != null) await supabase.from('alza_boxes').update({ lat: s.lat, lng: s.lng }).eq('id', k.id)
          } else {
            const { data, error } = await supabase.from('alza_boxes').insert({ code: s.code, name: s.name, address: s.address, lat: s.lat, lng: s.lng }).select('id').single()
            if (error) throw new Error(`${s.code}: ${error.message}`)
            ids.set(s.code, data.id); preview.known.set(s.code, { id: data.id, code: s.code, lat: s.lat, lng: s.lng })
          }
        }
        // 3) megállók cseréje a terv szerint — egy tranzakcióban a szerveren (félbeszakadva nem marad üres járat)
        const { error: rpcErr } = await supabase.rpc('replace_route_stops', {
          p_route_id: route.id,
          p_stops: pr.stops.map((s) => ({ box_id: ids.get(s.code)!, eta: s.eta, etd: s.etd, deadline: s.deadline })),
          p_planned_start: pr.start, p_planned_end: pr.end, p_source: preview.fileName,
        } as never)
        if (rpcErr) throw rpcErr
      }
    },
    onSuccess: () => {
      toast.success('Járatterv betöltve — a járatok a fájl szerint frissültek.')
      setPreview(null)
      void qc.invalidateQueries({ queryKey: ['route-stops'] }); void qc.invalidateQueries({ queryKey: ['route-names'] })
    },
    onError: (e) => setErr('Nem sikerült betölteni: ' + (errMsg(e, 'ismeretlen hiba'))),
  })

  return (
    <div className="card stack" style={{ gap: 8, padding: 12 }}>
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}><Icon name="upload" />Járatterv betöltése (csütörtöki xlsx)</div>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Olvasás…' : 'Fájl kiválasztása'}</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f) }} />
      </div>
      <div className="tiny muted">Az Alzától kapott heti terv („Utod ÉÉ-HH-NN.xlsx”): a járatok boxai és sorrendje a fájl szerint frissülnek, megállónként a tervezett érkezéssel és a határidővel. A futár a kártyán látja, mikorra kell odaérni; határidő után a leadáskor meg kell adnia a késés okát, amiről a vezetők pusht kapnak. A mentesítő (M) járatok nem változnak.</div>
      {preview && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="small" style={{ fontWeight: 700 }}>{preview.fileName} · {preview.routes.length} járat</div>
          {preview.routes.map((pr) => {
            const existing = (routes ?? []).find((r) => r.code.toUpperCase() === pr.code)
            const cur = existing ? (stopsByRoute?.[existing.id] ?? []) : []
            const curCodes = cur.map((s) => s.box.code?.toUpperCase() ?? '')
            // a jegyzékbeli kód (utótagos változat is) — így az összevetés a tényleges boxra megy
            const newCodes = pr.stops.map((s) => preview.known.get(s.code)?.code?.toUpperCase() ?? s.code)
            const added = newCodes.filter((c) => !curCodes.includes(c))
            const removed = curCodes.filter((c) => c && !newCodes.includes(c))
            const unknown = pr.stops.filter((s) => !preview.known.has(s.code)).map((s) => s.code)
            const same = existing && added.length === 0 && removed.length === 0 && curCodes.join() === newCodes.join()
            return (
              <div key={pr.vehicle} className="stack" style={{ gap: 2, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                <div className="between">
                  <span className="small" style={{ fontWeight: 700 }}>{pr.code} járat <span className="muted" style={{ fontWeight: 500 }}>· {pr.vehicle}</span></span>
                  <span className="tiny muted num">{pr.stops.length} box{pr.start ? ` · ${pr.start}–${pr.end ?? '?'}` : ''}{pr.distanceKm != null ? ` · ${Math.round(pr.distanceKm)} km` : ''}</span>
                </div>
                <div className="tiny muted">
                  {!existing ? 'Új járat lesz. ' : same ? 'A boxok és a sorrend megegyezik a mostanival — csak az idők frissülnek. ' : `${added.length} új box, ${removed.length} lekerül${added.length === 0 && removed.length === 0 ? ', a sorrend változik' : ''}. `}
                  {pr.stops.filter((s) => { const k = preview.known.get(s.code); return k?.code && k.code.toUpperCase() !== s.code }).map((s) => `${s.code} → ${preview.known.get(s.code)!.code}`).join(', ') || null}
                  {unknown.length > 0 && <span style={{ color: 'var(--warning)' }}> {unknown.length} box még nincs a jegyzékben ({unknown.join(', ')}) — a fájl adataival bekerül.</span>}
                </div>
                {(added.length > 0 || removed.length > 0) && (
                  <div className="tiny">
                    {added.length > 0 && <div><span style={{ color: 'var(--success)' }}>+</span> {added.join(', ')}</div>}
                    {removed.length > 0 && <div><span style={{ color: 'var(--danger)' }}>−</span> {removed.join(', ')}</div>}
                  </div>
                )}
              </div>
            )
          })}
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn ghost sm" style={{ flex: 1 }} onClick={() => setPreview(null)}>Mégse</button>
            <button type="button" className="btn sm" style={{ flex: 2 }} disabled={apply.isPending} onClick={() => apply.mutate()}><Icon name="check" size={14} />{apply.isPending ? 'Betöltés…' : 'Járatok frissítése a terv szerint'}</button>
          </div>
        </div>
      )}
      {err && <div className="alert error">{err}</div>}
      {profile?.role === 'admin' && <Link to="/jarat-valtozasok" className="tiny row" style={{ gap: 4, textDecoration: 'none' }}><Icon name="bar-chart" size={14} />Járat-változások feltöltésről feltöltésre (diagramok)</Link>}
    </div>
  )
}
