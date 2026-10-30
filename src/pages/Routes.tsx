import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAuth } from '../context/AuthContext'
import { depotOf, geocode } from '../lib/depot'
import { getCurrentPosition } from '../lib/geo'
import { parseHuNumber } from '../lib/labels'
import { useRoutes } from '../hooks/useRoutes'
import { useRouteStops } from '../hooks/useRouteStops'
import RouteStopsEditor from '../components/RouteStopsEditor'
import ReliefCard from '../components/ReliefCard'
import RoutePlanImport from '../components/RoutePlanImport'
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
                  {r.code}{r.is_relief ? <span className="tiny muted"> (mentesítő)</span> : null} <span className="tiny muted">· {stopsByRoute?.[r.id]?.length ?? 0} box</span>
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


// A raktár (depó): a járat utolsó boxa után a futár ide navigál, és a mentesítő-tervező
// innen számolja az oda-vissza utat. Csak az admin módosíthatja; a vezető látja.
function DepotCard() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace, reload } = useWorkspace()
  const isAdmin = profile?.role === 'admin'
  const depot = depotOf(currentWorkspace)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function openEditor() {
    setName(depot.name); setAddress(depot.address ?? ''); setLat(String(depot.lat)); setLng(String(depot.lng)); setMsg(null); setOpen(true)
  }
  async function lookup() {
    if (!address.trim()) { setMsg('Írd be a címet, utána keresem a koordinátát.'); return }
    setBusy(true); setMsg(null)
    try {
      const g = await geocode(address)
      if (g) { setLat(String(g.lat)); setLng(String(g.lng)); setMsg(`Találat: ${g.label}`) }
      else setMsg('Erre a címre nem találtam koordinátát — add meg kézzel, vagy állj a raktárnál és használd a jelenlegi pozíciót.')
    } catch { setMsg('A címkeresés most nem érhető el — add meg a koordinátát kézzel.') }
    setBusy(false)
  }
  async function useCurrent() {
    const gps = await getCurrentPosition()
    if (gps.lat != null && gps.lng != null) { setLat(String(gps.lat)); setLng(String(gps.lng)); setMsg(null) }
    else setMsg('Nem sikerült lekérni a pozíciót.')
  }
  async function save() {
    if (!currentWorkspaceId) return
    const pLat = parseHuNumber(lat), pLng = parseHuNumber(lng)
    if (!Number.isFinite(pLat) || !Number.isFinite(pLng) || pLat < -90 || pLat > 90 || pLng < -180 || pLng > 180) { setMsg('Érvénytelen koordináta — pl. 47.384 és 19.0297'); return }
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('workspaces').update({ depot_name: name.trim() || 'Alza raktár', depot_address: address.trim() || null, depot_lat: pLat, depot_lng: pLng }).eq('id', currentWorkspaceId)
    setBusy(false)
    if (error) { setMsg('Hiba: ' + error.message); return }
    setOpen(false)
    await reload()
  }
  return (
    <div className="card stack" style={{ gap: 8, padding: 12 }}>
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}><Icon name="warehouse" />Raktár (a járat vége)</div>
        {isAdmin && !open && <button type="button" className="btn ghost sm" onClick={openEditor}>Módosítás</button>}
      </div>
      {!open && (
        <div className="stack" style={{ gap: 2 }}>
          <div className="small" style={{ fontWeight: 700 }}>{depot.name}</div>
          <div className="small muted">{depot.address ?? 'A cím nincs megadva — a futár a koordinátára navigál.'}</div>
          <div className="tiny muted num">{depot.lat.toFixed(5)}, {depot.lng.toFixed(5)}{isAdmin ? '' : ' · csak az admin módosíthatja'}</div>
          <div className="tiny muted">Az utolsó box után a futár kártyáján „Navigálás a raktárba” ide visz; a mentesítő-tervező is innen számol.</div>
        </div>
      )}
      {open && (
        <div className="stack">
          <div className="field"><label>Név</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alza raktár" /></div>
          <div className="field"><label>Cím</label><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="irányítószám, város, utca, házszám" /></div>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void lookup()}><Icon name="search" size={14} />Koordináta keresése a címhez</button>
          <div className="grid-2">
            <div className="field"><label>Szélesség (lat)</label><input className="input" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="47.384" /></div>
            <div className="field"><label>Hosszúság (lng)</label><input className="input" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="19.0297" /></div>
          </div>
          <button type="button" className="btn ghost sm" onClick={() => void useCurrent()}><Icon name="navigation" size={14} />Jelenlegi pozícióm használata</button>
          {msg && <div className={`alert ${msg.startsWith('Hiba') || msg.startsWith('Érvénytelen') ? 'error' : ''}`}>{msg}</div>}
          <div className="btn-grid">
            <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Mégse</button>
            <button type="button" className="btn sm" disabled={busy || !lat || !lng} onClick={() => void save()}>Mentés</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Routes() {
  return (
    <div className="stack">
      <h2>Járatok</h2>
      <p className="small muted" style={{ margin: 0 }}>A Box-járatok (R, G, I…) és a hozzájuk tartozó AlzaBoxok sorrendje. A beosztásban körönként ezekből választható, ki melyik járatot viszi; a futár a kezdőlapi járat-kártyán ebben a sorrendben navigál boxról boxra, és a módosításról pusht kap.</p>
      <RoutePlanImport />
      <RoutesCard />
      <ReliefCard />
      <DepotCard />
    </div>
  )
}
