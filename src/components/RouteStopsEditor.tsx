import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAlzaBoxes } from '../hooks/useAlzaBoxes'
import { useRouteStops, type RouteStop } from '../hooks/useRouteStops'
import { normalize, type AlzaBox } from '../lib/boxSheet'
import { useRoutes, type RouteName } from '../hooks/useRoutes'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

// Egy járat megállói: AlzaBoxok sorrendben. A vezető itt rakja össze (keresés a
// jegyzékből, fel/le nyilak, törlés); a futár a kezdőlapi járat-kártyán ebben a
// sorrendben navigál boxról boxra.
export default function RouteStopsEditor({ route }: { route: RouteName }) {
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const { data: stopsByRoute } = useRouteStops()
  const { data: boxes } = useAlzaBoxes()
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const stops: RouteStop[] = stopsByRoute?.get(route.id) ?? []
  const { data: allRoutes } = useRoutes()
  const fromCode = (id: string) => allRoutes?.find((r) => r.id === id)?.code ?? '?'
  const used = new Set(stops.map((s) => s.box_id))
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['route-stops'] }); setErr(null) }
  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : 'A művelet nem sikerült')

  const add = useMutation({
    mutationFn: async (box: AlzaBox) => {
      const { error } = await supabase.from('route_stops').insert({
        workspace_id: currentWorkspaceId!, route_id: route.id, box_id: box.id, sort_order: (stops.length ? stops[stops.length - 1].sort_order : 0) + 1,
      })
      if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'Ez a box már rajta van a járaton' : error.message)
    },
    onSuccess: () => { setQ(''); invalidate() }, onError: fail,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('route_stops').delete().eq('id', id); if (error) throw error },
    onSuccess: invalidate, onError: fail,
  })
  // Csere a szomszéddal: a két sor sort_order-je helyet cserél
  const move = useMutation({
    mutationFn: async ({ idx, dir }: { idx: number; dir: -1 | 1 }) => {
      const a = stops[idx], b = stops[idx + dir]
      if (!a || !b) return
      // Egyforma sort_order esetén (régi adat) az indexből újraszámozunk
      const orderA = a.sort_order === b.sort_order ? idx + 1 : a.sort_order
      const orderB = a.sort_order === b.sort_order ? idx + 1 + dir : b.sort_order
      const r1 = await supabase.from('route_stops').update({ sort_order: orderB }).eq('id', a.id)
      if (r1.error) throw r1.error
      const r2 = await supabase.from('route_stops').update({ sort_order: orderA }).eq('id', b.id)
      if (r2.error) throw r2.error
    },
    onSuccess: invalidate, onError: fail,
  })

  // Fogd-és-vidd (egér és érintés): a fogantyúnál megfogva a sor a többi fölé/alá húzható,
  // elengedéskor az egész lista újrasorszámozódik
  const reorder = useMutation({
    mutationFn: async ({ from, to }: { from: number; to: number }) => {
      if (from === to) return
      const next = [...stops]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      const changed = next.map((st, i) => ({ id: st.id, order: i + 1 })).filter((x) => stops.find((st) => st.id === x.id)?.sort_order !== x.order)
      const results = await Promise.all(changed.map((x) => supabase.from('route_stops').update({ sort_order: x.order }).eq('id', x.id)))
      const bad = results.find((r) => r.error)
      if (bad?.error) throw bad.error
    },
    onSuccess: invalidate, onError: fail,
  })
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const [drag, setDrag] = useState<{ from: number; over: number; y: number } | null>(null)
  const dragRef = useRef<{ from: number; over: number } | null>(null)
  const startDrag = (idx: number) => (e: React.PointerEvent) => {
    if (busy) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    dragRef.current = { from: idx, over: idx }
    setDrag({ from: idx, over: idx, y: e.clientY })
  }
  const moveDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    // Melyik sor közepe fölött van az ujj/kurzor — az lesz a célhely
    let over = dragRef.current.from
    rowRefs.current.forEach((el, i) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      if (e.clientY > r.top + r.height / 2) over = i
      if (i === 0 && e.clientY < r.top + r.height / 2) over = 0
    })
    dragRef.current.over = over
    setDrag({ from: dragRef.current.from, over, y: e.clientY })
  }
  const endDrag = () => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (d && d.from !== d.over) reorder.mutate({ from: d.from, to: d.over })
  }

  const nq = normalize(q.trim())
  const results = nq.length >= 2
    ? (boxes ?? []).filter((b) => !used.has(b.id) && (normalize(b.code).includes(nq) || normalize(b.name).includes(nq) || normalize(b.address).includes(nq))).slice(0, 8)
    : []
  const busy = add.isPending || remove.isPending || move.isPending || reorder.isPending

  return (
    <div className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <div className="between">
        <span className="small" style={{ fontWeight: 700 }}><Icon name="map" size={14} />{route.code} járat megállói</span>
        <span className="tiny muted">{stops.length} box</span>
      </div>
      {stops.length === 0 && <div className="tiny muted">Még nincs box a járaton — keress rá kódra vagy névre, és add hozzá sorrendben.</div>}
      {stops.length > 1 && <div className="tiny muted">Sorrend: a <Icon name="grip" size={12} /> fogantyúnál megfogva húzd a kívánt helyre (ujjal is), vagy a nyilakkal lépkedj.</div>}
      {stops.map((s, i) => (
        <div key={s.id} ref={(el) => { rowRefs.current[i] = el }} className="row"
          style={{ gap: 6, alignItems: 'center', borderRadius: 8, padding: '2px 4px',
            background: drag && drag.over === i && drag.from !== i ? 'var(--primary-ghost)' : undefined,
            opacity: drag && drag.from === i ? 0.45 : 1,
            borderTop: drag && drag.over === i && drag.from > i ? '2px solid var(--primary)' : '2px solid transparent',
            borderBottom: drag && drag.over === i && drag.from < i ? '2px solid var(--primary)' : '2px solid transparent' }}>
          <span role="button" aria-label="Sorrend húzással" title="Húzd a kívánt helyre"
            onPointerDown={startDrag(i)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
            style={{ touchAction: 'none', cursor: drag ? 'grabbing' : 'grab', padding: '6px 2px', color: 'var(--text-dim)', display: 'inline-flex', userSelect: 'none' }}>
            <Icon name="grip" size={16} />
          </span>
          <span className="tiny muted" style={{ width: 22, textAlign: 'right', fontWeight: 700 }}>{i + 1}.</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="small" style={{ fontWeight: 700, lineHeight: 1.25 }}>{s.box.code ? `${s.box.code} · ` : ''}{s.box.name}</div>
            <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.box.address}{s.moved_from_route_id ? ` · átkerült: ${fromCode(s.moved_from_route_id)}` : ''}</div>
          </div>
          <button type="button" className="icon-btn" style={{ minWidth: 30, minHeight: 30, padding: 0 }} aria-label="Feljebb" disabled={busy || i === 0} onClick={() => move.mutate({ idx: i, dir: -1 })}><Icon name="chevron-up" size={16} /></button>
          <button type="button" className="icon-btn" style={{ minWidth: 30, minHeight: 30, padding: 0 }} aria-label="Lejjebb" disabled={busy || i === stops.length - 1} onClick={() => move.mutate({ idx: i, dir: 1 })}><Icon name="chevron-down" size={16} /></button>
          <ConfirmButton className="btn ghost sm auto" confirmLabel="Levétel?" disabled={busy} onConfirm={() => remove.mutate(s.id)} style={{ minHeight: 28, padding: '0 6px' }}>
            <Icon name="x" size={14} />
          </ConfirmButton>
        </div>
      ))}
      <div className="input-icon">
        <Icon name="search" size={16} />
        <input className="input" style={{ minHeight: 38, fontSize: 14 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Box hozzáadása: kód (AB1234) vagy név, cím…" />
      </div>
      {nq.length >= 2 && results.length === 0 && <div className="tiny muted">Nincs ilyen box a jegyzékben.</div>}
      {results.map((b) => (
        <button key={b.id} type="button" className="list-item" style={{ textAlign: 'left', cursor: 'pointer', padding: '6px 10px' }} disabled={busy} onClick={() => add.mutate(b)}>
          <div className="small" style={{ fontWeight: 700 }}><Icon name="plus" size={14} />{b.code ? `${b.code} · ` : ''}{b.name}</div>
          <div className="tiny muted">{b.address}</div>
        </button>
      ))}
      {err && <div className="alert error">{err}</div>}
    </div>
  )
}
