import { useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useRoutes } from '../hooks/useRoutes'
import { useRouteStops, type RouteStop } from '../hooks/useRouteStops'
import { planRelief, estimateRoute, fmtMin, nextReliefCode, type ReliefRoute, type ReliefPlan } from '../lib/relief'
import { toast } from '../lib/toast'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

// Mentesítő járat: ha sok a csomag, n boxot leveszünk a járatokról (a terheltebbekről
// elsőbbséggel, egymáshoz közeli címeket), és új M-járatra tesszük. Többször is
// futtatható — mindig az összes járat (a korábbi mentesítők is) boxait nézi.
// Feloszlatásnál a boxok visszakerülnek az eredeti járatukra.
export default function ReliefCard() {
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const { data: routes } = useRoutes()
  const { data: stopsByRoute } = useRouteStops()
  const [plan, setPlan] = useState<ReliefPlan | null>(null)
  // Melyik járatokról vehet le boxot a mentesítő (alapból mind; a kikapcsolt járat érintetlen marad)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)

  const model: ReliefRoute[] = useMemo(() => (routes ?? []).map((r) => ({
    id: r.id, code: r.code, isRelief: !!r.is_relief,
    stops: (stopsByRoute?.[r.id] ?? []).filter((s) => s.box.lat != null && s.box.lng != null)
      .map((s) => ({ id: s.id, boxId: s.box_id, code: s.box.code, name: s.box.name, lat: s.box.lat!, lng: s.box.lng! })),
  })).filter((r) => r.stops.length > 0), [routes, stopsByRoute])
  const selectedModel = model.filter((r) => !excluded.has(r.id))
  const total = selectedModel.reduce((a, r) => a + r.stops.length, 0)
  const noCoords = (routes ?? []).reduce((a, r) => a + (stopsByRoute?.[r.id] ?? []).filter((s) => s.box.lat == null).length, 0)
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['route-names'] }); void qc.invalidateQueries({ queryKey: ['route-stops'] }) }

  const create = useMutation({
    mutationFn: async () => {
      if (!plan) return
      const code = nextReliefCode((routes ?? []).map((r) => r.code))
      const { data: rn, error } = await supabase.from('route_names')
        .insert({ workspace_id: currentWorkspaceId!, code, sort_order: (routes?.length ?? 0) + 1, is_relief: true }).select('id').single()
      if (error) throw error
      // az átkerülő megállók eredeti helye megmarad (feloszlatáshoz)
      const all = routes!.flatMap((r) => stopsByRoute?.[r.id] ?? [])
      const rows = plan.relief.map((s, i) => {
        const orig = all.find((x) => x.id === s.id)
        return { workspace_id: currentWorkspaceId!, route_id: rn.id, box_id: s.boxId, sort_order: i + 1, moved_from_route_id: s.fromRouteId, moved_from_order: orig?.sort_order ?? null }
      })
      const ins = await supabase.from('route_stops').insert(rows)
      if (ins.error) throw ins.error
      const del = await supabase.from('route_stops').delete().in('id', plan.relief.map((s) => s.id))
      if (del.error) throw del.error
      // a megmaradt megállók újrasorszámozása az érintett járatokon
      for (const r of routes!) {
        const rest = (stopsByRoute?.[r.id] ?? []).filter((s) => !plan.relief.some((x) => x.id === s.id))
        await Promise.all(rest.map((s, i) => (s.sort_order === i + 1 ? null : supabase.from('route_stops').update({ sort_order: i + 1 }).eq('id', s.id))))
      }
      return code
    },
    onSuccess: (code) => { toast.success(`Mentesítő járat létrehozva: ${code} — a beosztásban már választható.`); setPlan(null); invalidate() },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Nem sikerült létrehozni'),
  })

  const dissolve = useMutation({
    mutationFn: async (routeId: string) => {
      const stops: RouteStop[] = stopsByRoute?.[routeId] ?? []
      // vissza az eredeti járatra (a lista végére, az eredeti sorrendjük szerint), ha ott még nincs
      const byOrigin = new Map<string, RouteStop[]>()
      for (const s of stops) if (s.moved_from_route_id) { if (!byOrigin.has(s.moved_from_route_id)) byOrigin.set(s.moved_from_route_id, []); byOrigin.get(s.moved_from_route_id)!.push(s) }
      for (const [origId, list] of byOrigin) {
        if (!routes?.some((r) => r.id === origId)) continue
        const existing = stopsByRoute?.[origId] ?? []
        let next = (existing.length ? Math.max(...existing.map((s) => s.sort_order)) : 0) + 1
        const rows = list.sort((a, b) => (a.moved_from_order ?? 0) - (b.moved_from_order ?? 0))
          .filter((s) => !existing.some((e) => e.box_id === s.box_id))
          .map((s) => ({ workspace_id: currentWorkspaceId!, route_id: origId, box_id: s.box_id, sort_order: next++ }))
        if (rows.length) { const { error } = await supabase.from('route_stops').insert(rows); if (error) throw error }
      }
      const unlink = await supabase.from('shifts').update({ route_id: null }).eq('route_id', routeId)
      if (unlink.error) throw unlink.error
      const { error } = await supabase.from('route_names').delete().eq('id', routeId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Mentesítő járat feloszlatva — a boxok visszakerültek az eredeti járatukra.'); setPlan(null); invalidate() },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Nem sikerült feloszlatni'),
  })

  // A javaslat helyben szerkeszthető a létrehozás előtt: sorrend húzással, box levétele (× — visszakerül az eredeti járatára).
  // A becslések (km, idő, a többi járat) a módosítás után újraszámolódnak.
  const applyRelief = (relief: ReliefPlan['relief']) => {
    if (!plan) return
    const chosen = new Set(relief.map((s) => s.id))
    const after = model.filter((r) => plan.before.some((b) => b.id === r.id)).map((r) => {
      const rest = r.stops.filter((s) => !chosen.has(s.id))
      return { id: r.id, code: r.code, est: estimateRoute(rest), removed: r.stops.length - rest.length }
    })
    setPlan({ ...plan, relief, after, reliefEst: estimateRoute(relief) })
  }
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const dragRef = useRef<{ from: number; over: number } | null>(null)
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const startDrag = (idx: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    dragRef.current = { from: idx, over: idx }; setDrag({ from: idx, over: idx })
  }
  const moveDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    let over = dragRef.current.from
    rowRefs.current.forEach((el, i) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      if (e.clientY > r.top + r.height / 2) over = i
      if (i === 0 && e.clientY < r.top + r.height / 2) over = 0
    })
    dragRef.current.over = over; setDrag({ from: dragRef.current.from, over })
  }
  const endDrag = () => {
    const d = dragRef.current
    dragRef.current = null; setDrag(null)
    if (d && plan && d.from !== d.over) {
      const next = [...plan.relief]
      const [m] = next.splice(d.from, 1)
      next.splice(d.over, 0, m)
      applyRelief(next)
    }
  }

  const reliefRoutes = (routes ?? []).filter((r) => r.is_relief)
  const busy = create.isPending || dissolve.isPending
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="card-title" style={{ margin: 0 }}><Icon name="repeat" />Mentesítő járat</div>
      <p className="tiny muted" style={{ margin: 0 }}>
        Ha sok a csomag: a javaslat úgy vesz le boxokat a járatokról (a korábbi mentesítőkről is), hogy az új M-járattal együtt a járatok nagyjából ugyanannyi km-t és ugyanannyi időt fussanak — mindig a leghosszabb járatról, az egymáshoz közeli címeket. A km és az idő becslés (légvonal × úttényező, 32 km/h, boxonként 7 perc), a járatok összevetésére való.
      </p>
      {model.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="tiny muted">Pipáld ki, mely járatokról vehet le boxot a mentesítő:</div>
          {model.map((r) => { const e = estimateRoute(r.stops); const on = !excluded.has(r.id); return (
            <label key={r.id} className="between tiny" style={{ cursor: 'pointer', opacity: on ? 1 : 0.55 }}>
              <span className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={on} onChange={() => { setPlan(null); setExcluded((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n }) }} />
                <span><strong>{r.code}</strong>{r.isRelief ? <span className="badge" style={{ marginLeft: 6, fontSize: 10 }}>mentesítő</span> : null} · {e.stops} box</span>
              </span>
              <span className="muted">{Math.round(e.km)} km · {fmtMin(e.minutes)}</span>
            </label>
          ) })}
          {noCoords > 0 && <div className="tiny muted">{noCoords} box koordináta nélkül — ezeket a javaslat nem tudja figyelembe venni.</div>}
        </div>
      )}
      <button type="button" className="btn sm auto" disabled={total < 2 || busy} onClick={() => { setErr(null); const pl = planRelief(selectedModel); setPlan(pl); if (!pl) setErr(selectedModel.length === 0 ? 'Válassz legalább egy járatot.' : 'Nincs mit kiegyenlíteni: a mentesítő nem rövidítené a leghosszabb kiválasztott járatot.') }}>
        <Icon name="map" size={14} />Javaslat (km és idő kiegyenlítése)
      </button>
      {plan && (
        <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div className="between">
            <span className="small" style={{ fontWeight: 700 }}>Új járat: {nextReliefCode((routes ?? []).map((r) => r.code))} · {plan.relief.length} box</span>
            <span className="tiny muted">{Math.round(plan.reliefEst.km)} km · {fmtMin(plan.reliefEst.minutes)}</span>
          </div>
          <div className="tiny muted">A <Icon name="grip" size={12} /> fogantyúval húzva a sorrend módosítható, a × leveszi a boxot a javaslatból (marad az eredeti járatán).</div>
          {plan.relief.map((s, i) => (
            <div key={s.id} ref={(el) => { rowRefs.current[i] = el }} className="tiny" style={{ display: 'flex', gap: 6, alignItems: 'center', borderRadius: 6, padding: '2px 4px',
              background: drag && drag.over === i && drag.from !== i ? 'var(--primary-ghost)' : undefined, opacity: drag && drag.from === i ? 0.45 : 1,
              borderTop: drag && drag.over === i && drag.from > i ? '2px solid var(--primary)' : '2px solid transparent',
              borderBottom: drag && drag.over === i && drag.from < i ? '2px solid var(--primary)' : '2px solid transparent' }}>
              <span role="button" aria-label="Sorrend húzással" onPointerDown={startDrag(i)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                style={{ touchAction: 'none', cursor: drag ? 'grabbing' : 'grab', padding: '6px 2px', color: 'var(--text-dim)', display: 'inline-flex', userSelect: 'none' }}>
                <Icon name="grip" size={14} />
              </span>
              <span className="muted" style={{ width: 22, textAlign: 'right' }}>{i + 1}.</span>
              <span style={{ flex: 1 }}>{s.code ? `${s.code} · ` : ''}{s.name}</span>
              <span className="badge" style={{ fontSize: 10 }}>{s.fromCode}-ről</span>
              <button type="button" className="icon-btn" style={{ minWidth: 28, minHeight: 28, padding: 0 }} aria-label="Levétel a javaslatból" disabled={busy || plan.relief.length <= 1}
                onClick={() => applyRelief(plan.relief.filter((x) => x.id !== s.id))}><Icon name="x" size={14} /></button>
            </div>
          ))}
          <div className="tiny muted" style={{ fontWeight: 700 }}>A kiválasztott járatok a levétel után{excluded.size ? ` (érintetlen: ${model.filter((r) => excluded.has(r.id)).map((r) => r.code).join(', ')})` : ''}:</div>
          {plan.after.map((a) => { const b = plan.before.find((x) => x.id === a.id)!; return (
            <div key={a.id} className="between tiny">
              <span><strong>{a.code}</strong> · {a.est.stops} box{a.removed ? <span className="muted"> (−{a.removed})</span> : null}</span>
              <span className="muted">{Math.round(b.est.km)} → {Math.round(a.est.km)} km · {fmtMin(b.est.minutes)} → {fmtMin(a.est.minutes)}</span>
            </div>
          ) })}
          <div className="row" style={{ gap: 6 }}>
            <ConfirmButton className="btn sm" confirmLabel="Biztos? Létrehozom és leveszem a boxokat" disabled={busy} onConfirm={() => create.mutate()}>
              <Icon name="check" size={14} />Létrehozás
            </ConfirmButton>
            <button type="button" className="btn ghost sm auto" disabled={busy} onClick={() => setPlan(null)}>Mégse</button>
          </div>
        </div>
      )}
      {reliefRoutes.length > 0 && (
        <div className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div className="tiny muted" style={{ fontWeight: 700 }}>Meglévő mentesítő járatok</div>
          {reliefRoutes.map((r) => (
            <div key={r.id} className="between" style={{ gap: 8 }}>
              <span className="small"><strong>{r.code}</strong> · {(stopsByRoute?.[r.id] ?? []).length} box</span>
              <ConfirmButton className="btn ghost sm auto" confirmLabel="Feloszlatom, a boxok visszakerülnek" disabled={busy} onConfirm={() => dissolve.mutate(r.id)}>
                <Icon name="x" size={14} />Feloszlatás
              </ConfirmButton>
            </div>
          ))}
        </div>
      )}
      {err && <div className="alert error">{err}</div>}
    </div>
  )
}
