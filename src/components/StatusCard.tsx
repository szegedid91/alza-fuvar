import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { recordStatusEvent } from '../lib/statusEvents'
import { todayISO } from '../lib/labels'
import { toast } from '../lib/toast'
import { groupTarget, copyText, statusText, sharePhotos, canShareFiles, STATUS_META, type StatusKind } from '../lib/groupMessage'
import { submitNow } from '../lib/outbox'
import CameraCapture from './CameraCapture'
import { useState } from 'react'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'
import type { Tables } from '../lib/database.types'
import { errMsg } from '../lib/errors'

type StatusEvent = Tables<'status_events'> & { photos?: { id: string; storage_path: string | null }[] }

// "Jelzés a csoportba": Megérkeztem / Kiindultam / Járat kész / Elszámoltam egy
// koppintásra (az app rögzíti — idő, GPS, autó — a vezetők látják; a WhatsApp a
// kész üzenettel nyílik). A box-hibák fotóval a Box-lapon mennek.
export default function StatusCard() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const { data: today } = useToday()
  const qc = useQueryClient()
  const date = todayISO()
  const name = profile?.full_name || profile?.email || 'Munkatárs'
  // A csoportba a kiosztott járat kódja megy (rendszám nem)
  const route = today?.planned?.routeCode ?? null
  // „Elszámoltam”: fotóval — a kamera nyílik, a kép az appba mentődik, és a
  // megosztás-menün át a csoportba megy a szöveggel (mint a box-fotók)
  const [settleCamera, setSettleCamera] = useState(false)
  const [settleShot, setSettleShot] = useState<{ blob: Blob; previewUrl: string; at: Date } | null>(null)
  const [settleBusy, setSettleBusy] = useState(false)
  const shareOk = canShareFiles()

  const { data: events } = useQuery({
    queryKey: ['status-events', currentWorkspaceId, profile?.id, date],
    enabled: !!currentWorkspaceId && !!profile,
    queryFn: async () => {
      const { data, error } = await supabase.from('status_events').select('*, photos:status_event_photos(id, storage_path)')
        .eq('workspace_id', currentWorkspaceId!).eq('user_id', profile!.id).eq('work_date', date).order('at')
      if (error) throw error
      return (data ?? []) as StatusEvent[]
    },
  })
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['status-events'] }) }

  // Újraküldés: a már rögzített jelzés szövege még egyszer a csoportba
  function resend(ev: StatusEvent) {
    const text = statusText(ev.kind as StatusKind, new Date(ev.at), name, route, ev.note)
    window.open(groupTarget(currentWorkspace, text).url, '_blank', 'noopener')
  }
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
  const lastOf = (kind: StatusKind) => [...(events ?? [])].reverse().find((e) => e.kind === kind) ?? null

  // Rögzítés a háttérben (offline is sorba áll) — a WhatsApp-link maga a gomb
  async function record(kind: StatusKind, at: Date): Promise<string | null> {
    if (!currentWorkspaceId || !profile) return null
    try {
      const id = await recordStatusEvent({ workspaceId: currentWorkspaceId, userId: profile.id, carId: today?.car?.id ?? null, kind, at, geofence: currentWorkspace })
      invalidate()
      return id
    } catch (e) {
      toast.error('A jelzés rögzítése nem sikerült: ' + (errMsg(e, 'ismeretlen hiba')))
      return null
    }
  }

  // Elszámolás fotóval: a kép elkészültekor rögzül a jelzés (idő = a kattintás),
  // a fotó a háttérben megy fel (offline is sorba áll) — a küldés külön koppintás,
  // mert a megosztás-menüt a böngésző csak érintésre nyitja
  async function onSettleCaptured(blob: Blob, previewUrl: string) {
    setSettleCamera(false)
    if (!currentWorkspaceId || !profile) return
    const at = new Date()
    setSettleBusy(true)
    try {
      const eventId = await record('settled', at)
      if (!eventId) return
      const photoId = crypto.randomUUID()
      await submitNow({
        id: photoId, table: 'status_event_photos', op: 'insert', label: 'Elszámolás fotó',
        values: { id: photoId, workspace_id: currentWorkspaceId, event_id: eventId },
        photo: { workspaceId: currentWorkspaceId, folder: `status/${eventId}`, id: photoId, column: 'storage_path', blob },
      })
      invalidate()
      setSettleShot({ blob, previewUrl, at })
    } catch (e) {
      toast.error('A fotó mentése nem sikerült: ' + (errMsg(e, 'ismeretlen hiba')))
      setSettleShot({ blob, previewUrl, at })
    } finally {
      setSettleBusy(false)
    }
  }

  async function shareSettle() {
    if (!settleShot) return
    const text = statusText('settled', settleShot.at, name, route)
    const res = await sharePhotos([settleShot.blob], text, 'elszamolas')
    if (res === 'shared') { toast.success('Megosztva — a WhatsAppban válaszd a csoportot és küldd el.'); setSettleShot(null) }
    else if (res === 'cancelled') toast.info('A megosztás megszakadt — a kép az appban megvan, újra megoszthatod.')
    else window.open(groupTarget(currentWorkspace, text).url, '_blank', 'noopener')
  }

  async function undo(ev: StatusEvent) {
    const { error } = await supabase.from('status_events').delete().eq('id', ev.id)
    if (error) { toast.error('Nem sikerült visszavonni: ' + error.message); return }
    toast.info('Jelzés visszavonva.')
    invalidate()
  }

  const simple: StatusKind[] = ['arrived', 'departed', 'done', 'settled']

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}><Icon name="send" />Jelzés a csoportba</div>
        <span className="tiny muted">a csoportot a WhatsAppban választod</span>
      </div>

      <div className="grid-2" style={{ gap: 8 }}>
        {simple.map((kind) => {
          const meta = STATUS_META[kind]
          const last = lastOf(kind)
          if (kind === 'settled') {
            return (
              <button key={kind} type="button" className={`btn ${last ? 'secondary' : ''}`} disabled={settleBusy}
                style={{ flexDirection: 'column', gap: 2, minHeight: 64, padding: '8px 4px' }}
                onClick={() => { setSettleShot(null); setSettleCamera(true) }}>
                <Icon name="camera" />
                <span style={{ fontSize: 13, fontWeight: 800 }}>{meta.label}</span>
                <span className="tiny" style={{ opacity: 0.85 }}>{last ? hhmm(last.at) : 'fotóval'}</span>
              </button>
            )
          }
          const text = statusText(kind, new Date(), name, route)
          const target = groupTarget(currentWorkspace, text)
          return (
            <a key={kind} className={`btn ${last ? 'secondary' : ''}`} href={target.url} target="_blank" rel="noopener noreferrer"
              style={{ textDecoration: 'none', flexDirection: 'column', gap: 2, minHeight: 64, padding: '8px 4px' }}
              // Az üzenet ideje a KOPPINTÁS pillanata — a href-et a navigáció előtt frissítjük;
              // csoport-linknél a szöveg a vágólapra megy
              onClick={(e) => {
                const at = new Date()
                const t = statusText(kind, at, name, route)
                const tg = groupTarget(currentWorkspace, t)
                e.currentTarget.href = tg.url
                if (tg.viaClipboard) void copyText(t)
                void record(kind, at)
              }}>
              <Icon name={meta.icon} />
              <span style={{ fontSize: 13, fontWeight: 800 }}>{meta.label}</span>
              <span className="tiny" style={{ opacity: 0.85 }}>{last ? hhmm(last.at) : '—'}</span>
            </a>
          )
        })}
      </div>

      {settleCamera && (
        <CameraCapture title="Elszámolás — fotó" onCancel={() => setSettleCamera(false)} onCapture={(b, u) => void onSettleCaptured(b, u)} />
      )}
      {settleShot && (
        <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div className="between">
            <strong className="small">Elszámoltam {hhmm(settleShot.at.toISOString())} — fotó mentve</strong>
            <button type="button" className="btn ghost sm auto" onClick={() => setSettleShot(null)}><Icon name="x" size={15} /></button>
          </div>
          <img src={settleShot.previewUrl} alt="Elszámolás fotó" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: '#000' }} />
          <div className="btn-grid">
            <button type="button" className="btn ghost" onClick={() => { setSettleShot(null); setSettleCamera(true) }}><Icon name="refresh" />Újra</button>
            <button type="button" className="btn" onClick={() => void shareSettle()}>
              <Icon name="send" />{shareOk ? 'Küldés a csoportba' : 'Küldés (szöveg)'}
            </button>
          </div>
          {!shareOk && <div className="tiny muted">Ezen a készüléken a kép nem adható át a WhatsAppnak — a szöveg megy, a kép az appban megvan (a vezetők látják).</div>}
        </div>
      )}

      {(events?.length ?? 0) > 0 && (
        <div className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {events!.map((ev) => {
            const meta = STATUS_META[ev.kind as StatusKind]
            const text = statusText(ev.kind as StatusKind, new Date(ev.at), name, route, ev.note)
            const iconBtn = { minHeight: 32, minWidth: 32, padding: 0, width: 32, flexShrink: 0 } as const
            return (
              <div key={ev.id} className="between" style={{ gap: 6, alignItems: 'flex-start' }}>
                <div className="row" style={{ gap: 6, minWidth: 0, alignItems: 'flex-start', flex: 1 }}>
                  <Icon name={meta.icon} size={14} style={{ color: meta.color, flexShrink: 0, marginTop: 3 }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="tiny"><strong>{hhmm(ev.at)}</strong> {meta.title}{ev.photos?.length ? ` · ${ev.photos.length} fotó` : ev.photo_path ? ' · fotó' : ''}</div>
                    {ev.note && (
                      <div className="tiny muted" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{ev.note}</div>
                    )}
                  </div>
                </div>
                <span className="row" style={{ gap: 4, flexShrink: 0 }}>
                  <a className="btn ghost sm auto" style={{ ...iconBtn, textDecoration: 'none' }} aria-label="Újraküldés WhatsAppon" title="Újraküldés WhatsAppon"
                    href={groupTarget(currentWorkspace, text).url} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); resend(ev) }}>
                    <Icon name="send" size={15} />
                  </a>
                  <ConfirmButton className="btn ghost sm auto" confirmLabel="Törlés?" onConfirm={() => void undo(ev)} style={{ minHeight: 32, padding: '0 8px', flexShrink: 0 }}>
                    <Icon name="x" size={15} />
                  </ConfirmButton>
                </span>
              </div>
            )
          })}
          <div className="tiny muted" style={{ marginTop: 2 }}><Icon name="send" size={12} style={{ verticalAlign: -2 }} /> = újraküldés WhatsAppon · × = visszavonás</div>
        </div>
      )}
      <p className="tiny muted" style={{ margin: 0 }}>
        Koppints, és a WhatsApp a kész üzenettel nyílik — válaszd ki a csoportot, küldd el. Az idő itt is rögzül, a vezetők látják. Az „Elszámoltam” fotóval megy: a kép az appba mentődik, és a csoportba is küldheted.
      </p>
    </div>
  )
}
