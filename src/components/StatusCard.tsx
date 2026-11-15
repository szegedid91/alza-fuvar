import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { recordStatusEvent } from '../lib/statusEvents'
import { todayISO } from '../lib/labels'
import { toast } from '../lib/toast'
import { groupTarget, statusText, STATUS_META, type StatusKind, openWhatsApp } from '../lib/groupMessage'
import { submitNow } from '../lib/outbox'
import MultiShotCamera from './MultiShotCamera'
import { useState, useEffect } from 'react'
import Icon from './Icon'
import type { Tables } from '../lib/database.types'
import { errMsg } from '../lib/errors'

type StatusEvent = Tables<'status_events'> & { photos?: { id: string; storage_path: string | null }[] }

// "Jelzés a csoportba": Megérkeztem / Kiindultam / Járat kész / Elszámoltam egy
// koppintásra (az app rögzíti — idő, GPS, autó — a vezetők látják; a WhatsApp a
// kész üzenettel nyílik). A box-hibák fotóval a Box-lapon mennek.
// roundsOver: minden mai kör „Járat kész” — a „Kiindultam” inaktív, a következő lépés az „Elszámoltam”
// onRoute: a futár épp a járaton van, a járat-kártya vezeti boxról boxra — a „Járat kész” az utolsó box gombja, itt nincs kiemelve
export default function StatusCard({ roundsOver = false, onRoute = false }: { roundsOver?: boolean; onRoute?: boolean } = {}) {
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
  function sendSettle(blobs: Blob[], posters: (Blob | undefined)[] = []) {
    if (!currentWorkspaceId || !profile) return
    const at = new Date()
    const text = statusText('settled', at, name, route)
    setSettleCamera(false)
    // A visszáru fotói és videói CSAK az appban maradnak (bizonyíték a vezetőknek) — a csoportba csak a jelzés szövege megy
    openWhatsApp(text)
    void (async () => {
      try {
        const eventId = await record('settled', at)
        if (!eventId) return
        for (const [i, blob] of blobs.entries()) {
          const photoId = crypto.randomUUID()
          await submitNow({
            id: photoId, table: 'status_event_photos', op: 'insert', label: blob.type.startsWith('video/') ? 'Elszámolás videó' : 'Elszámolás fotó',
            values: { id: photoId, workspace_id: currentWorkspaceId, event_id: eventId },
            photo: { workspaceId: currentWorkspaceId, folder: `status/${eventId}`, id: photoId, column: 'storage_path', blob, poster: posters[i] },
          })
        }
        toast.success('Elszámolás rögzítve — a felvételek az appban vannak, a vezetők látják.')
        invalidate()
      } catch (e) {
        toast.error('A felvétel mentése nem sikerült: ' + (errMsg(e, 'ismeretlen hiba')))
      }
    })()
  }

  // További felvételek a már rögzített elszámoláshoz (pl. ha egy láda kimaradt a képről): csak az appba mentjük
  function addSettlePhotos(blobs: Blob[], posters: (Blob | undefined)[] = []) {
    const ev = lastOf('settled')
    if (!currentWorkspaceId || !profile || !ev) return
    setMoreCamera(false)
    void (async () => {
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
        invalidate()
      } catch (e) {
        toast.error('A felvétel mentése nem sikerült: ' + (errMsg(e, 'ismeretlen hiba')))
      }
    })()
  }

  const simple: StatusKind[] = ['arrived', 'departed', 'done', 'settled']
  // Melyik a következő lépés? (ciklus: Megérkeztem → Kiindultam → Járat kész → Megérkeztem…)
  const lastPhase = [...(events ?? [])].reverse().find((e) => e.kind === 'arrived' || e.kind === 'departed' || e.kind === 'done')?.kind ?? null
  const settledAfterDone = (() => { const d = lastOf('done'); const s = lastOf('settled'); return !!s && (!d || s.at > d.at) })()
  const nextKind: StatusKind | null = roundsOver
    ? (settledAfterDone ? null : 'settled')
    : lastPhase === 'arrived' ? 'departed' : lastPhase === 'departed' ? (onRoute ? null : 'done') : 'arrived'
  // az utolsó kör után már nincs kiindulás és járat kész — ezek inaktívak
  const inactive = (kind: StatusKind) => roundsOver && (kind === 'departed' || kind === 'done')
  // Járat közben a „Járat kész” és a „Megérkeztem” megszakítaná a járatot — ezek két koppintásra mennek (véletlen érintés ellen)
  const needsConfirm = (kind: StatusKind) => onRoute && (kind === 'done' || kind === 'arrived')
  const [armed, setArmed] = useState<StatusKind | null>(null)
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(null), 4000); return () => clearTimeout(t) }, [armed])

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}><Icon name="send" />Jelzés a csoportba</div>
        <span className="tiny muted">a csoportot a WhatsAppban választod</span>
      </div>

      {/* Egy nagy gomb: a soron következő jelzés. A többi kicsiben, alatta — koppintható marad (javításhoz, ismétléshez). */}
      {(() => {
        const button = (kind: StatusKind, big: boolean) => {
          const meta = STATUS_META[kind]
          const last = lastOf(kind)
          const bigStyle: React.CSSProperties = { flexDirection: 'column', gap: 2, minHeight: 64, padding: '8px 4px', width: '100%' }
          const smallStyle: React.CSSProperties = { gap: 6, minHeight: 36, padding: '4px 10px', fontSize: 13, opacity: inactive(kind) ? 0.35 : 0.8, pointerEvents: inactive(kind) ? 'none' : undefined }
          if (kind === 'settled') {
            return (
              <button key={kind} type="button" className={big ? 'btn' : 'btn ghost sm auto'} style={big ? bigStyle : smallStyle} onClick={() => setSettleCamera(true)}>
                <Icon name="camera" size={big ? 24 : 14} />
                <span style={{ fontWeight: 800 }}>{meta.label}</span>
                <span className="tiny" style={{ opacity: 0.85 }}>{!big && last ? hhmm(last.at) : 'fotóval vagy videóval'}</span>
              </button>
            )
          }
          const target = groupTarget(currentWorkspace, statusText(kind, new Date(), name, route))
          return (
            <a key={kind} className={big ? 'btn' : 'btn ghost sm auto'} href={target.url} target="_blank" rel="noopener noreferrer" aria-disabled={inactive(kind)}
              title={inactive(kind) ? 'Minden mai kör kész — már nem kell kiindulni' : undefined}
              style={{ textDecoration: 'none', ...(big ? bigStyle : smallStyle) }}
              // Az üzenet ideje a KOPPINTÁS pillanata — a href-et a navigáció előtt frissítjük
              onClick={(e) => {
                // LOG-37: amíg az előző koppintás rögzítése fut, a második nem rögzít újra
                if (sending || inactive(kind)) { e.preventDefault(); return }
                if (needsConfirm(kind) && armed !== kind) { e.preventDefault(); setArmed(kind); return }
                setArmed(null)
                // a WhatsApp a koppintáson belül nyílik, de nem új fülön: visszaváltáskor az app legyen elöl
                e.preventDefault()
                const at = new Date()
                const t = statusText(kind, at, name, route)
                openWhatsApp(t)
                setSending(kind)
                void record(kind, at).finally(() => setSending(null))
              }}>
              <Icon name={meta.icon} size={big ? 24 : 14} />
              <span style={{ fontWeight: 800, color: armed === kind ? 'var(--danger)' : undefined }}>{armed === kind ? `Biztos? ${meta.label}` : meta.label}</span>
              {!big && armed !== kind && <span className="tiny" style={{ opacity: 0.85 }}>{last ? hhmm(last.at) : '—'}</span>}
            </a>
          )
        }
        return (
          <>
            {nextKind && button(nextKind, true)}
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {simple.filter((k) => k !== nextKind).map((k) => button(k, false))}
            </div>
          </>
        )
      })()}

      {moreCamera && (
        <MultiShotCamera video upload title="További visszáru-felvétel" sendLabel="Mentés" hint="Fotózd vagy videózd le, ami az előző felvételekről kimaradt — minden visszahozott csomag látszódjon." onCancel={() => setMoreCamera(false)} onSend={addSettlePhotos} />
      )}
      {lastOf('settled') && !moreCamera && (
        <button type="button" className="btn secondary sm" onClick={() => setMoreCamera(true)}>
          <Icon name="camera" size={14} />További visszáru-fotó vagy videó{(lastOf('settled')?.photos?.length ?? 0) ? ` (eddig ${lastOf('settled')!.photos!.length})` : ''}
        </button>
      )}
      {settleCamera && (
        <MultiShotCamera video upload title="Elszámolás — visszáru" sendLabel="Mentés" hint="Fotózd vagy videózd le az ÖSSZES visszahozott csomagot — mindegyik látszódjon. Ez igazolja, hogy visszakerült a raktárba. Ha nem jött vissza semmi, az üres rakteret fotózd le. Kész felvételt is feltölthetsz a telefonról. A felvétel csak az appba kerül." onCancel={() => setSettleCamera(false)} onSend={sendSettle} />
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
