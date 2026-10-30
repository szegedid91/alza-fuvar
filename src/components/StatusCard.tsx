import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { submitNow } from '../lib/outbox'
import { getCurrentPosition, isOutsideGeofence } from '../lib/geo'
import { todayISO } from '../lib/labels'
import { toast } from '../lib/toast'
import { groupTarget, copyText, statusText, STATUS_META, type StatusKind } from '../lib/groupMessage'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'
import type { Tables } from '../lib/database.types'

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
  const plate = today?.car?.plate ?? null

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
    const text = statusText(ev.kind as StatusKind, new Date(ev.at), name, plate, ev.note)
    window.open(groupTarget(currentWorkspace, text).url, '_blank', 'noopener')
  }
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
  const lastOf = (kind: StatusKind) => [...(events ?? [])].reverse().find((e) => e.kind === kind) ?? null

  // Rögzítés a háttérben (offline is sorba áll) — a WhatsApp-link maga a gomb
  async function record(kind: StatusKind, at: Date): Promise<string | null> {
    if (!currentWorkspaceId || !profile) return null
    try {
      const gps = await getCurrentPosition(4000)
      const outside = currentWorkspace ? isOutsideGeofence(gps, currentWorkspace) : false
      const id = crypto.randomUUID()
      await submitNow({
        id, table: 'status_events', op: 'insert', label: `${STATUS_META[kind].title} – jelzés`,
        values: {
          id, workspace_id: currentWorkspaceId, user_id: profile.id, car_id: today?.car?.id ?? null, work_date: date, kind,
          at: at.toISOString(), gps_lat: gps.lat, gps_lng: gps.lng, outside_geofence: outside, note: null, confirmed_at: at.toISOString(),
        },
      })
      invalidate()
      return id
    } catch (e) {
      toast.error('A jelzés rögzítése nem sikerült: ' + (e instanceof Error ? e.message : 'ismeretlen hiba'))
      return null
    }
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
          const text = statusText(kind, new Date(), name, plate)
          const target = groupTarget(currentWorkspace, text)
          return (
            <a key={kind} className={`btn ${last ? 'secondary' : ''}`} href={target.url} target="_blank" rel="noopener noreferrer"
              style={{ textDecoration: 'none', flexDirection: 'column', gap: 2, minHeight: 64, padding: '8px 4px' }}
              // Az üzenet ideje a KOPPINTÁS pillanata — a href-et a navigáció előtt frissítjük;
              // csoport-linknél a szöveg a vágólapra megy
              onClick={(e) => {
                const at = new Date()
                const t = statusText(kind, at, name, plate)
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

      {(events?.length ?? 0) > 0 && (
        <div className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {events!.map((ev) => {
            const meta = STATUS_META[ev.kind as StatusKind]
            const text = statusText(ev.kind as StatusKind, new Date(ev.at), name, plate, ev.note)
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
        A gomb rögzíti az időt (a vezetők látják) és megnyitja a WhatsAppot a kész üzenettel — válaszd ki a csoportot és küldd el. Ha nem ment el, a <Icon name="send" size={12} /> gombbal újraküldheted. Box-hibát fotóval a Box-lapon jelenthetsz.
      </p>
    </div>
  )
}
