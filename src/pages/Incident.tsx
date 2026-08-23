import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PhotoSlot, { type CapturedPhoto } from '../components/PhotoSlot'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { supabase } from '../lib/supabase'
import { submitNow } from '../lib/outbox'
import { getCurrentPosition } from '../lib/geo'
import { todayISO, formatDateTime } from '../lib/labels'
import { resolveNames } from '../lib/names'
import { signedUrls } from '../lib/photos'

export default function Incident() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const { data: today } = useToday()
  const qc = useQueryClient()
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // Az elmúlt 24 óra eseményei: a sajátjaim + ami a mai autómon történt
  // (így ha ketten ülnek az autón, mindkettejük eseményét látja mindkét fél).
  // A 24 órás korlátot a szerver (RLS) is kikényszeríti a munkatársaknál.
  const carId = today?.car?.id
  const { data: list } = useQuery({
    queryKey: ['incidents', currentWorkspaceId, profile?.id, carId],
    enabled: !!currentWorkspaceId && !!profile,
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      let q = supabase.from('incidents').select('*')
        .eq('workspace_id', currentWorkspaceId!)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(20)
      q = carId ? q.or(`user_id.eq.${profile!.id},car_id.eq.${carId}`) : q.eq('user_id', profile!.id)
      const { data } = await q
      const rows = data ?? []
      const [names, urls] = await Promise.all([
        resolveNames(rows.map((r) => r.user_id)),
        signedUrls(rows.map((r) => r.photo_path).filter((x): x is string => !!x)),
      ])
      return rows.map((r) => ({
        ...r,
        _name: r.user_id ? (names[r.user_id] ?? null) : null,
        _url: r.photo_path ? (urls[r.photo_path] ?? null) : null,
      }))
    },
  })

  async function submit() {
    if (!currentWorkspaceId || !profile || !photo) return
    setBusy(true); setMsg(null)
    try {
      const gps = await getCurrentPosition()
      const id = crypto.randomUUID()
      await submitNow({
        id, table: 'incidents', op: 'insert', label: 'Esemény/baleset',
        values: {
          id, workspace_id: currentWorkspaceId, car_id: today?.car?.id ?? null,
          user_id: profile.id, work_date: todayISO(), note: note.trim() || null,
          gps_lat: gps.lat, gps_lng: gps.lng,
        },
        photo: { workspaceId: currentWorkspaceId, folder: 'incidents', id, column: 'photo_path', blob: photo.blob },
      })
      setPhoto(null); setNote(''); setMsg('Esemény rögzítve.')
      await qc.invalidateQueries({ queryKey: ['incidents'] })
    } catch (e) {
      setMsg('Hiba: ' + (e instanceof Error ? e.message : 'ismeretlen'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <h2>Esemény / baleset</h2>
      <div className="card stack">
        <p className="small muted">Azonnali dokumentáció: fotó, GPS, időbélyeg és leírás.</p>
        <div style={{ maxWidth: 220 }}>
          <PhotoSlot label="Fotó" photo={photo} onCapture={setPhoto} />
        </div>
        <div className="field">
          <label>Leírás</label>
          <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Mi történt?" />
        </div>
        {msg && <div className={`alert ${msg.startsWith('Hiba') ? 'error' : 'success'}`}>{msg}</div>}
        <button className="btn danger" disabled={!photo || busy} onClick={() => void submit()}>
          {busy ? 'Mentés…' : 'Esemény rögzítése'}
        </button>
      </div>

      {(list?.length ?? 0) > 0 && (
        <div className="card stack">
          <div className="card-title">🕑 Események az elmúlt 24 órában</div>
          <p className="tiny muted" style={{ margin: 0 }}>
            A saját és a mai autódon rögzített események. Koppints a képre a teljes mérethez.
          </p>
          {list!.map((i) => (
            <div key={i.id} className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div className="between">
                <span className="small" style={{ fontWeight: 700 }}>
                  {i.user_id === profile?.id ? 'Én' : (i._name ?? 'Munkatárs')}
                </span>
                <span className="tiny muted">{formatDateTime(i.created_at)}</span>
              </div>
              {i._url && (
                <img
                  src={i._url}
                  alt="Esemény fotó"
                  style={{ width: '100%', maxWidth: 320, borderRadius: 10, cursor: 'zoom-in' }}
                  onClick={() => window.open(i._url!, '_blank')}
                />
              )}
              <span className="small">{i.note || '(nincs leírás)'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
