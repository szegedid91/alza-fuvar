import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAuth } from '../context/AuthContext'
import { submitNow } from '../lib/outbox'
import { ITEM_KINDS, cleanPackageCode, itemKindLabel, itemKindShort, type ItemKind } from '../lib/boxItems'
import { toast } from '../lib/toast'
import { errMsg } from '../lib/errors'
import CameraCapture from './CameraCapture'
import PhotoThumb from './PhotoThumb'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

export interface StopItem {
  id: string; kind: string; package_code: string | null; note: string | null; return_to_depot: boolean; created_at: string
  photos: { id: string; storage_path: string | null }[]
}

// Egy megálló csomagszintű eltérései (sérült, ismeretlen, nincs vonalkód…) a fotóikkal
export function useStopItems(stopId: string) {
  return useQuery({
    queryKey: ['stop-items', stopId],
    queryFn: async (): Promise<StopItem[]> => {
      const { data, error } = await supabase.from('box_stop_items').select('id, kind, package_code, note, return_to_depot, created_at, photos:box_stop_item_photos(id, storage_path)')
        .eq('stop_id', stopId).order('created_at')
      if (error) throw error
      return (data ?? []) as unknown as StopItem[]
    },
  })
}

// Csomagszintű eltérések a Box-lapon: típus + csomagkód + fotó + „visszaviszem a raktárba”.
// A mentés a helyi soron át megy (gyenge netnél sorba áll, később felmegy).
export default function StopItems({ stopId, items, readOnly = false }: { stopId: string; items: StopItem[]; readOnly?: boolean }) {
  const { currentWorkspaceId } = useWorkspace()
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<ItemKind | null>(null)
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [back, setBack] = useState(true)
  const [shots, setShots] = useState<{ blob: Blob; url: string }[]>([])
  const [cam, setCam] = useState(false)
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['stop-items', stopId] })
  const reset = () => { setAdding(false); setKind(null); setCode(''); setNote(''); setBack(true); setShots([]) }

  const save = useMutation({
    mutationFn: async () => {
      if (!currentWorkspaceId || !kind) throw new Error('Válaszd ki az eltérés típusát')
      const id = crypto.randomUUID()
      const r = await submitNow({
        id, table: 'box_stop_items', op: 'insert', label: `Eltérés: ${itemKindLabel(kind)}`,
        values: { id, workspace_id: currentWorkspaceId, stop_id: stopId, kind, package_code: cleanPackageCode(code), note: note.trim() || null, return_to_depot: back, created_by: profile?.id ?? null },
      })
      let queued = r.queued
      for (const s of shots) {
        const pid = crypto.randomUUID()
        const pr = await submitNow({
          id: pid, table: 'box_stop_item_photos', op: 'insert', label: `Eltérés-fotó (${itemKindShort(kind)})`,
          values: { id: pid, workspace_id: currentWorkspaceId, item_id: id, storage_path: null },
          photo: { workspaceId: currentWorkspaceId, folder: `boxitems/${id}`, id: pid, column: 'storage_path', blob: s.blob },
        })
        queued = queued || pr.queued
      }
      return queued
    },
    onSuccess: (queued) => {
      reset(); invalidate()
      if (queued) toast.info('Nincs net — az eltérés és a fotó sorba állt, kapcsolatnál felmegy.')
      else toast.success('Eltérés rögzítve.')
    },
    onError: (e) => toast.error(errMsg(e, 'A mentés nem sikerült')),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('box_stop_items').delete().eq('id', id); if (error) throw error },
    onSuccess: invalidate, onError: (e) => toast.error(errMsg(e, 'A törlés nem sikerült')),
  })

  return (
    <div className="stack" style={{ gap: 6, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
      <div className="between">
        <div className="small" style={{ fontWeight: 700 }}><Icon name="alert-triangle" size={16} style={{ verticalAlign: -3 }} /> Csomag-eltérések{items.length ? ` (${items.length})` : ''}</div>
        {!readOnly && !adding && <button type="button" className="btn ghost sm auto" onClick={() => setAdding(true)}><Icon name="plus" size={14} />Eltérés</button>}
      </div>
      {items.map((it) => (
        <div key={it.id} className="between" style={{ gap: 8, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div className="small"><span className="badge warning">{itemKindShort(it.kind)}</span> {it.package_code && <span className="num">{it.package_code}</span>}{it.return_to_depot && <span className="tiny muted"> · visszaviszi</span>}</div>
            {it.note && <div className="tiny muted">{it.note}</div>}
            {it.photos.length > 0 && <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 4 }}>{it.photos.map((p) => p.storage_path && <div key={p.id} style={{ width: 48 }}><PhotoThumb path={p.storage_path} /></div>)}</div>}
          </div>
          {!readOnly && <ConfirmButton className="icon-btn" confirmLabel="Törlés?" onConfirm={() => remove.mutate(it.id)}><Icon name="trash" size={14} /></ConfirmButton>}
        </div>
      ))}
      {items.length === 0 && !adding && <div className="tiny muted">Sérült, ismeretlen, vonalkód nélküli, rossz ládába címkézett, máshová berakott, reklamációs vagy ADMIN csomagnál: „+ Eltérés” — kóddal és fotóval, így a raktár és az Alza is látja.</div>}
      {adding && (
        <div className="stack" style={{ gap: 8, padding: 8, borderRadius: 10, background: 'var(--primary-ghost)' }}>
          <div className="chips" style={{ gap: 6 }}>
            {ITEM_KINDS.map((k) => <button key={k.key} type="button" className={`chip ${kind === k.key ? 'active' : ''}`} aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>{k.label}</button>)}
          </div>
          {kind && <div className="tiny muted">{ITEM_KINDS.find((k) => k.key === kind)?.hint}</div>}
          <div className="field">
            <label>Csomagkód (a címkéről)</label>
            <input className="input num" inputMode="numeric" value={code} placeholder="pl. 1612345678" onChange={(e) => setCode(e.target.value)} />
          </div>
          <input className="input" value={note} placeholder="megjegyzés (pl. hova tetted, mi sérült)" onChange={(e) => setNote(e.target.value)} />
          <label className="row small" style={{ gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={back} onChange={(e) => setBack(e.target.checked)} />Visszaviszem a raktárba
          </label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {shots.map((s, i) => <img key={i} src={s.url} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />)}
            <button type="button" className="btn ghost sm auto" onClick={() => setCam(true)}><Icon name="camera" size={14} />{shots.length ? 'még egy fotó' : 'Fotó'}</button>
          </div>
          {cam && <CameraCapture title={`${kind ? itemKindLabel(kind) : 'Eltérés'} — fotó`} onCancel={() => setCam(false)} onCapture={(blob, url) => { setShots((p) => [...p, { blob, url }]); setCam(false) }} />}
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn ghost sm" style={{ flex: 1 }} onClick={reset}>Mégse</button>
            <button type="button" className="btn sm" style={{ flex: 2 }} disabled={!kind || save.isPending} onClick={() => save.mutate()}><Icon name="check" size={14} />Rögzítés</button>
          </div>
        </div>
      )}
    </div>
  )
}
