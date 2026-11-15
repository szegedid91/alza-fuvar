import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { submitNow } from '../lib/outbox'
import { todayISO } from '../lib/labels'
import { toast } from '../lib/toast'
import { errMsg } from '../lib/errors'
import Icon from './Icon'
import PhotoThumb from './PhotoThumb'
import MultiShotCamera from './MultiShotCamera'

// Elszámolás UTÁN (a nap végi kártyán): a visszáruról készült felvételek, és még lehet hozzájuk tenni —
// ha a futár pl. csak videót mentett, de fotót is akar, vagy valami kimaradt. A felvétel csak az appba kerül.
export default function SettleMedia() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const date = todayISO()
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)

  const { data: ev } = useQuery({
    // a „status-events” előtag miatt a jelzések frissítése ezt is frissíti
    queryKey: ['status-events', currentWorkspaceId, profile?.id, date, 'settle-media'],
    enabled: !!currentWorkspaceId && !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('status_events').select('id, at, photos:status_event_photos(id, storage_path)')
        .eq('workspace_id', currentWorkspaceId!).eq('user_id', profile!.id).eq('work_date', date).eq('kind', 'settled')
        .order('at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data as unknown as { id: string; at: string; photos: { id: string; storage_path: string | null }[] | null } | null
    },
  })

  async function add(blobs: Blob[], posters: (Blob | undefined)[] = []) {
    if (!currentWorkspaceId || !profile || !ev) return
    setCamera(false); setBusy(true)
    try {
      for (const [i, blob] of blobs.entries()) {
        const photoId = crypto.randomUUID()
        await submitNow({
          id: photoId, table: 'status_event_photos', op: 'insert', label: blob.type.startsWith('video/') ? 'Elszámolás videó' : 'Elszámolás fotó',
          values: { id: photoId, workspace_id: currentWorkspaceId, event_id: ev.id },
          photo: { workspaceId: currentWorkspaceId, folder: `status/${ev.id}`, id: photoId, column: 'storage_path', blob, poster: posters[i] },
        })
      }
      toast.success(`${blobs.length} további felvétel mentve az elszámoláshoz.`)
      await qc.invalidateQueries({ queryKey: ['status-events'] })
    } catch (e) {
      toast.error('A felvétel mentése nem sikerült: ' + errMsg(e, 'ismeretlen hiba'))
    } finally { setBusy(false) }
  }

  if (!ev) return null
  const photos = ev.photos ?? []
  const shown = photos.filter((p) => !!p.storage_path)
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="between" style={{ gap: 8 }}>
        <span className="small" style={{ fontWeight: 700 }}><Icon name="camera" size={14} /> Visszáru-felvételek{photos.length ? ` (${photos.length})` : ''}</span>
      </div>
      {shown.length > 0 && (
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {shown.map((p) => <div key={p.id} style={{ width: 64 }}><PhotoThumb path={p.storage_path!} /></div>)}
        </div>
      )}
      {photos.length === 0 && <div className="tiny" style={{ color: 'var(--warning)' }}>Az elszámoláshoz még nincs felvétel.</div>}
      <button type="button" className="btn secondary sm" disabled={busy} onClick={() => setCamera(true)}>
        <Icon name="camera" size={14} />{busy ? 'Mentés…' : 'További fotó vagy videó a visszáruról'}
      </button>
      {camera && (
        <MultiShotCamera video title="További visszáru-felvétel" sendLabel="Mentés" hint="Fotózd vagy videózd le, ami az előző felvételekről kimaradt — minden visszahozott csomag látszódjon."
          onCancel={() => setCamera(false)} onSend={(blobs, posters) => void add(blobs, posters)} />
      )}
    </div>
  )
}
