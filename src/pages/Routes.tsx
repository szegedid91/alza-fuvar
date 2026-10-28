import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useRoutes } from '../hooks/useRoutes'
import { useRouteStops } from '../hooks/useRouteStops'
import RouteStopsEditor from '../components/RouteStopsEditor'
import ReliefCard from '../components/ReliefCard'
import RoutePreview from '../components/RoutePreview'
import ConfirmButton from '../components/ConfirmButton'
import Icon from '../components/Icon'

// Járatok (R, G, I…) kezelése: a beosztás Box-celláiban ezekből választható, ki
// melyik járatot viszi; járatonként a boxok sorrendje is itt állítható
function RoutesCard() {
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const { data: routes } = useRoutes()
  const { data: stopsByRoute } = useRouteStops()
  const [code, setCode] = useState('')
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['route-names'] }); setErr(null) }
  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : 'A művelet nem sikerült')
  const add = useMutation({
    mutationFn: async () => {
      const c = code.trim().toUpperCase()
      if (!c) return
      const { error } = await supabase.from('route_names').insert({ workspace_id: currentWorkspaceId!, code: c, sort_order: (routes?.length ?? 0) + 1 })
      if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'Ez a járat már létezik' : error.message)
    },
    onSuccess: () => { setCode(''); invalidate() }, onError: fail,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('route_names').delete().eq('id', id); if (error) throw error },
    onSuccess: invalidate, onError: fail,
  })
  const list = routes ?? []
  const editingRoute = list.find((r) => r.id === editing) ?? null
  return (
    <div className="card stack" style={{ gap: 8, padding: 12 }}>
      <button type="button" className="between" style={{ background: 'none', border: 'none', padding: 0, width: '100%', color: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => setOpen((o) => !o)}>
        <div className="card-title" style={{ margin: 0 }}><Icon name="map" />Járatok{list.length ? ` (${list.map((r) => r.code).join(', ')})` : ''}</div>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} className="muted" />
      </button>
      {open && (
        <>
          <div className="tiny muted">A járatok nevei (pl. R, G, I). A Box-autók celláiban körönként választható, ki melyik járatot viszi; a munkatárs a saját beosztásában látja. Egy járatot egy napon egy körben csak egy autó vihet. A járat nevére koppintva a boxok sorrendje állítható — a futár ebből navigál.</div>
          <div className="chips">
            {list.map((r) => (
              <span key={r.id} className={`chip ${editing === r.id ? 'active' : ''}`} style={{ gap: 4, paddingRight: 6 }}>
                <button type="button" onClick={() => setEditing((e) => (e === r.id ? null : r.id))} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', fontWeight: 700 }}>
                  {r.code}{r.is_relief ? <span className="tiny muted"> (mentesítő)</span> : null} <span className="tiny muted">· {stopsByRoute?.get(r.id)?.length ?? 0} box</span>
                </button>
                <ConfirmButton className="btn ghost sm auto" confirmLabel="Törlés?" disabled={remove.isPending} onConfirm={() => remove.mutate(r.id)} style={{ minHeight: 24, padding: '0 4px' }}>
                  <Icon name="x" size={12} />
                </ConfirmButton>
              </span>
            ))}
            {list.length === 0 && <span className="tiny muted">Még nincs járat megadva.</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input" style={{ minHeight: 38, padding: '6px 10px', fontSize: 14, maxWidth: 160 }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Új járat neve"
              onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) add.mutate() }} />
            <button className="btn sm auto" style={{ minHeight: 38 }} disabled={!code.trim() || add.isPending} onClick={() => add.mutate()} aria-label="Járat hozzáadása"><Icon name="plus" size={16} /></button>
          </div>
          {editingRoute && <RouteStopsEditor route={editingRoute} />}
          {err && <div className="alert error">{err}</div>}
        </>
      )}
    </div>
  )
}


export default function Routes() {
  return (
    <div className="stack">
      <h2>Járatok</h2>
      <p className="small muted" style={{ margin: 0 }}>A Box-járatok (R, G, I…) és a hozzájuk tartozó AlzaBoxok sorrendje. A beosztásban körönként ezekből választható, ki melyik járatot viszi; a futár a kezdőlapi járat-kártyán ebben a sorrendben navigál boxról boxra, és a módosításról pusht kap.</p>
      <RoutesCard />
      <ReliefCard />
      <RoutePreview />
    </div>
  )
}
