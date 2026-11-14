import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { recordStatusEvent } from '../lib/statusEvents'
import { todayISO } from '../lib/labels'
import { toast } from '../lib/toast'
import { groupTarget, statusText, sharePhotos, canShareFiles, STATUS_META, type StatusKind, openWhatsApp } from '../lib/groupMessage'
import { submitNow } from '../lib/outbox'
import MultiShotCamera from './MultiShotCamera'
import { useState } from 'react'
import Icon from './Icon'
import type { Tables } from '../lib/database.types'
import { errMsg } from '../lib/errors'

type StatusEvent = Tables<'status_events'> & { photos?: { id: string; storage_path: string | null }[] }

// "Jelzés a csoportba": Megérkeztem / Kiindultam / Járat kész / Elszámoltam egy
// koppintásra (az app rögzíti — idő, GPS, autó — a vezetők látják; a WhatsApp a
// kész üzenettel nyílik). A box-hibák fotóval a Box-lapon mennek.
// roundsOver: minden mai kör „Járat kész” — a „Kiindultam” inaktív, a következő lépés az „Elszámoltam”
export default function StatusCard({ roundsOver = false }: { roundsOver?: boolean } = {}) {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const { data: today } = useToday()
  const qc = useQueryClient()
  const date = todayISO()
  const name = profile?.full_name || profile?.email || 'Munkatárs'
  // A csoportba a kiosztott járat kódja megy (rendszám nem)
  const route = today?.planned?.routeCode ?? null
  // „Elszámoltam”: fotóval — a kamera nyílik (több kép is lehet), a „Küldés”
  // koppintásra AZONNAL a WhatsApp nyílik a képekkel és a szöveggel; a jelzés és
  // a képek mentése a háttérben megy (offline is sorba áll)
  const [settleCamera, setSettleCamera] = useState(false)
  // további visszáru-fotók a mai (legutóbbi) elszámoláshoz — új jelzés nélkül
  const [moreCamera, setMoreCamera] = useState(false)
  const [sending, setSending] = useState<StatusKind | null>(null)
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

  // Elszámolás fotóval: a „Küldés” koppintáson belül nyílik a megosztás-menü
  // (a böngésző csak érintésre engedi) — ezért ELŐBB a megosztás indul, és csak
  // utána, párhuzamosan a rögzítés + feltöltés
  function sendSettle(blobs: Blob[]) {
    if (!currentWorkspaceId || !profile) return
    const at = new Date()
    const text = statusText('settled', at, name, route)
    setSettleCamera(false)
    let sharing: Promise<'shared' | 'cancelled' | 'unsupported'> | null = null
    if (shareOk) sharing = sharePhotos(blobs, text, 'elszamolas')
    else openWhatsApp(text)
    void (async () => {
      try {
        const eventId = await record('settled', at)
        if (!eventId) return
        for (const blob of blobs) {
          const photoId = crypto.randomUUID()
          await submitNow({
            id: photoId, table: 'status_event_photos', op: 'insert', label: 'Elszámolás fotó',
            values: { id: photoId, workspace_id: currentWorkspaceId, event_id: eventId },
            photo: { workspaceId: currentWorkspaceId, folder: `status/${eventId}`, id: photoId, column: 'storage_path', blob },
          })
        }
        invalidate()
      } catch (e) {
        toast.error('A fotó mentése nem sikerült: ' + (errMsg(e, 'ismeretlen hiba')))
      }
    })()
    void sharing?.then((res) => {
      if (res === 'shared') toast.success('Megosztva — a WhatsAppban válaszd a csoportot és küldd el. A képek az appban is megvannak.')
      else if (res === 'cancelled') toast.info('A megosztás megszakadt — a jelzés és a képek az appban megvannak, a listából újraküldheted.')
      else openWhatsApp(text)
    })
  }

  // További fotók a már rögzített elszámoláshoz (pl. ha egy láda kimaradt a képről): mentés az appba, és megosztás a csoportba
  function addSettlePhotos(blobs: Blob[]) {
    const ev = lastOf('settled')
    if (!currentWorkspaceId || !profile || !ev) return
    setMoreCamera(false)
    const text = `Elszámolás – további visszáru-fotók – ${name}${route ? ` (${route} járat)` : ''}`
    let sharing: Promise<'shared' | 'cancelled' | 'unsupported'> | null = null
    if (shareOk) sharing = sharePhotos(blobs, text, 'elszamolas')
    void (async () => {
      try {
        for (const blob of blobs) {
          const photoId = crypto.randomUUID()
          await submitNow({
            id: photoId, table: 'status_event_photos', op: 'insert', label: 'Elszámolás fotó',
            values: { id: photoId, workspace_id: currentWorkspaceId, event_id: ev.id },
            photo: { workspaceId: currentWorkspaceId, folder: `status/${ev.id}`, id: photoId, column: 'storage_path', blob },
          })
        }
        toast.success(`${blobs.length} további fotó mentve az elszámoláshoz.`)
        invalidate()
      } catch (e) {
        toast.error('A fotó mentése nem sikerült: ' + (errMsg(e, 'ismeretlen hiba')))
      }
    })()
    void sharing?.then((res) => { if (res === 'cancelled') toast.info('A megosztás megszakadt — a képek az appban megvannak.') })
  }

  const simple: StatusKind[] = ['arrived', 'departed', 'done', 'settled']
  // Melyik a következő lépés? (ciklus: Megérkeztem → Kiindultam → Járat kész → Megérkeztem…)
  const lastPhase = [...(events ?? [])].reverse().find((e) => e.kind === 'arrived' || e.kind === 'departed' || e.kind === 'done')?.kind ?? null
  const settledAfterDone = (() => { const d = lastOf('done'); const s = lastOf('settled'); return !!s && (!d || s.at > d.at) })()
  const nextKind: StatusKind | null = roundsOver
    ? (settledAfterDone ? null : 'settled')
    : lastPhase === 'arrived' ? 'departed' : lastPhase === 'departed' ? 'done' : 'arrived'
  // az utolsó kör után már nincs kiindulás és járat kész — ezek inaktívak
  const inactive = (kind: StatusKind) => roundsOver && (kind === 'departed' || kind === 'done')

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
              <button key={kind} type="button" className={`btn ${nextKind === 'settled' ? '' : last ? 'secondary' : ''}`}
                style={{ flexDirection: 'column', gap: 2, minHeight: 64, padding: '8px 4px' }}
                onClick={() => setSettleCamera(true)}>
                <Icon name="camera" />
                <span style={{ fontSize: 13, fontWeight: 800 }}>{meta.label}</span>
                <span className="tiny" style={{ opacity: 0.85 }}>{last ? hhmm(last.at) : 'fotóval'}</span>
              </button>
            )
          }
          const text = statusText(kind, new Date(), name, route)
          const target = groupTarget(currentWorkspace, text)
          return (
            <a key={kind} className={`btn ${kind === nextKind ? '' : 'secondary'}`} href={target.url} target="_blank" rel="noopener noreferrer" aria-disabled={inactive(kind)}
              title={inactive(kind) ? 'Minden mai kör kész — már nem kell kiindulni' : undefined}
              style={{ textDecoration: 'none', flexDirection: 'column', gap: 2, minHeight: 64, padding: '8px 4px', opacity: kind === nextKind ? 1 : inactive(kind) ? 0.35 : 0.7, pointerEvents: inactive(kind) ? 'none' : undefined }}
              // Az üzenet ideje a KOPPINTÁS pillanata — a href-et a navigáció előtt frissítjük;
              // csoport-linknél a szöveg a vágólapra megy
              onClick={(e) => {
                // LOG-37: amíg az előző koppintás rögzítése fut, a második nem rögzít újra
                if (sending || inactive(kind)) { e.preventDefault(); return }
                // a WhatsApp a koppintáson belül nyílik, de nem új fülön: visszaváltáskor az app legyen elöl
                e.preventDefault()
                const at = new Date()
                const t = statusText(kind, at, name, route)
                openWhatsApp(t)
                setSending(kind)
                void record(kind, at).finally(() => setSending(null))
              }}>
              <Icon name={meta.icon} />
              <span style={{ fontSize: 13, fontWeight: 800 }}>{meta.label}</span>
              <span className="tiny" style={{ opacity: 0.85 }}>{last ? hhmm(last.at) : '—'}</span>
            </a>
          )
        })}
      </div>

      {moreCamera && (
        <MultiShotCamera title="További visszáru-fotók" sendLabel="Mentés és küldés" hint="Fotózd le, ami az előző képekről kimaradt — minden visszahozott tétel látszódjon." onCancel={() => setMoreCamera(false)} onSend={addSettlePhotos} />
      )}
      {lastOf('settled') && !moreCamera && (
        <button type="button" className="btn secondary sm" onClick={() => setMoreCamera(true)}>
          <Icon name="camera" size={14} />További visszáru-fotó az elszámoláshoz{(lastOf('settled')?.photos?.length ?? 0) ? ` (eddig ${lastOf('settled')!.photos!.length} kép)` : ''}
        </button>
      )}
      {settleCamera && (
        <MultiShotCamera title="Elszámolás — visszáru fotók" sendLabel="Küldés a csoportba" hint="Fotózd le az összes visszahozott árut — több képen, hogy minden tétel látszódjon. Ez igazolja, hogy a termék visszakerült a raktárba." onCancel={() => setSettleCamera(false)} onSend={sendSettle} />
      )}

      {roundsOver && (
        <div className="tiny" style={{ color: 'var(--success)', fontWeight: 600 }}>
          <Icon name="check-circle" size={12} style={{ verticalAlign: -2 }} /> Minden kör kész. Most: „Elszámoltam” a visszáruval, utána takarítás és „Autó lerakva”.
        </div>
      )}
      <p className="tiny muted" style={{ margin: 0 }}>
        Koppints: a WhatsApp a kész üzenettel nyílik, válaszd a csoportot és küldd el.
      </p>
    </div>
  )
}
