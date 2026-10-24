import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { submitNow } from '../lib/outbox'
import { getCurrentPosition, isOutsideGeofence } from '../lib/geo'
import { todayISO } from '../lib/labels'
import { toast } from '../lib/toast'
import { groupTarget, copyText, canShareFiles, sharePhoto, statusText, STATUS_META, type StatusKind } from '../lib/groupMessage'
import PhotoSlot, { type CapturedPhoto } from './PhotoSlot'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'
import type { Tables } from '../lib/database.types'

type StatusEvent = Tables<'status_events'>

// "Jelzés a csoportba": Megérkeztem / Kiindultam / Járat kész egy koppintásra
// (az app rögzíti — idő, GPS, autó — a vezetők látják; a WhatsApp a kész
// üzenettel nyílik), és Hiba fotóval (a telefon megosztás-menüjén át megy a
// kép + szöveg a csoportba).
export default function StatusCard() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const { data: today } = useToday()
  const qc = useQueryClient()
  const date = todayISO()
  const name = profile?.full_name || profile?.email || 'Munkatárs'
  const plate = today?.car?.plate ?? null
  const groupName = currentWorkspace?.arrival_whatsapp_group_name ?? null
  const hasGroup = !!currentWorkspace?.arrival_whatsapp_group

  const { data: events } = useQuery({
    queryKey: ['status-events', currentWorkspaceId, profile?.id, date],
    enabled: !!currentWorkspaceId && !!profile,
    queryFn: async () => {
      const { data, error } = await supabase.from('status_events').select('*')
        .eq('workspace_id', currentWorkspaceId!).eq('user_id', profile!.id).eq('work_date', date).order('at')
      if (error) throw error
      return (data ?? []) as StatusEvent[]
    },
  })
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['status-events'] }) }
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
  const lastOf = (kind: StatusKind) => [...(events ?? [])].reverse().find((e) => e.kind === kind) ?? null

  // Rögzítés a háttérben (offline is sorba áll) — a WhatsApp-link maga a gomb
  async function record(kind: StatusKind, at: Date, note: string | null, photo: CapturedPhoto | null): Promise<string | null> {
    if (!currentWorkspaceId || !profile) return null
    try {
      const gps = await getCurrentPosition(4000)
      const outside = currentWorkspace ? isOutsideGeofence(gps, currentWorkspace) : false
      const id = crypto.randomUUID()
      await submitNow({
        id, table: 'status_events', op: 'insert', label: `${STATUS_META[kind].title} – jelzés`,
        values: {
          id, workspace_id: currentWorkspaceId, user_id: profile.id, car_id: today?.car?.id ?? null, work_date: date, kind,
          at: at.toISOString(), gps_lat: gps.lat, gps_lng: gps.lng, outside_geofence: outside, note,
        },
        photo: photo ? { workspaceId: currentWorkspaceId, folder: `status/${id}`, id, column: 'photo_path', blob: photo.blob } : undefined,
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

  // ---- Hiba fotóval
  const [issueOpen, setIssueOpen] = useState(false)
  const [issueNote, setIssueNote] = useState('')
  const [issuePhoto, setIssuePhoto] = useState<CapturedPhoto | null>(null)
  const [issueBusy, setIssueBusy] = useState(false)
  const shareOk = canShareFiles()

  async function sendIssue() {
    if (!issuePhoto) return
    setIssueBusy(true)
    const at = new Date()
    const text = statusText('issue', at, name, plate, issueNote)
    try {
      const id = await record('issue', at, issueNote.trim() || null, issuePhoto)
      if (!id) return
      const res = await sharePhoto(issuePhoto.blob, text, `hiba-${date}.jpg`)
      if (res === 'shared') toast.success('Megosztva — a WhatsAppban válaszd a csoportot és küldd el.')
      else if (res === 'cancelled') toast.info('A megosztás megszakadt — a hiba rögzítve, a vezetők látják. Újra megoszthatod az alábbi gombbal.')
      else toast.info('Ezen a készüléken a kép nem adható át a WhatsAppnak — a hiba fotóval rögzítve, a vezetők látják.')
      setIssueOpen(false); setIssueNote(''); setIssuePhoto(null)
    } finally {
      setIssueBusy(false)
    }
  }

  const simple: StatusKind[] = ['arrived', 'departed', 'done']

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}><Icon name="send" />Jelzés a csoportba</div>
        {hasGroup
          ? <span className="tiny row" style={{ gap: 4 }}><Icon name="check" size={14} style={{ color: 'var(--success)' }} /><strong>{groupName ?? 'csoport beállítva'}</strong></span>
          : <span className="tiny muted">csoportot a WhatsAppban választod</span>}
      </div>

      <div className="grid-3" style={{ gap: 8 }}>
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
                void record(kind, at, null, null)
              }}>
              <Icon name={meta.icon} />
              <span style={{ fontSize: 13, fontWeight: 800 }}>{meta.label}</span>
              <span className="tiny" style={{ opacity: 0.85 }}>{last ? hhmm(last.at) : '—'}</span>
            </a>
          )
        })}
      </div>

      {!issueOpen ? (
        <button type="button" className="btn ghost" onClick={() => setIssueOpen(true)} style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          <Icon name="alert-triangle" />Hiba jelentése fotóval
        </button>
      ) : (
        <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div className="small" style={{ fontWeight: 800 }}><Icon name="alert-triangle" size={16} style={{ color: 'var(--danger)', verticalAlign: -3 }} /> Hiba jelentése</div>
          <div style={{ width: 160 }}>
            <PhotoSlot label="Fotó a hibáról" photo={issuePhoto} onCapture={setIssuePhoto} />
          </div>
          <div className="field">
            <label>Mi a hiba? (ez megy a csoportba a kép mellé)</label>
            <input className="input" value={issueNote} onChange={(e) => setIssueNote(e.target.value)} placeholder="pl. AB9103 box nem nyílik" />
          </div>
          {!shareOk && <div className="tiny muted">Ezen a készüléken a kép nem adható át közvetlenül a WhatsAppnak — a hiba fotóval az appban rögzül, a vezetők látják.</div>}
          <div className="btn-grid">
            <button type="button" className="btn ghost sm" onClick={() => { setIssueOpen(false); setIssuePhoto(null); setIssueNote('') }}>Mégse</button>
            <button type="button" className="btn sm" disabled={!issuePhoto || issueBusy} onClick={() => void sendIssue()}>
              <Icon name="send" size={16} />{issueBusy ? 'Küldés…' : shareOk ? 'Küldés a csoportba' : 'Rögzítés'}
            </button>
          </div>
        </div>
      )}

      {(events?.length ?? 0) > 0 && (
        <div className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {events!.map((ev) => {
            const meta = STATUS_META[ev.kind as StatusKind]
            return (
              <div key={ev.id} className="between" style={{ gap: 8 }}>
                <span className="tiny row" style={{ gap: 6, minWidth: 0 }}>
                  <Icon name={meta.icon} size={14} style={{ color: meta.color, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong>{hhmm(ev.at)}</strong> {meta.title}{ev.note ? ` — ${ev.note}` : ''}{ev.photo_path ? ' · fotó' : ''}
                  </span>
                </span>
                <ConfirmButton className="btn ghost sm auto" confirmLabel="Törlés?" onConfirm={() => void undo(ev)} style={{ minHeight: 28, padding: '0 8px' }}>
                  <Icon name="x" size={14} />
                </ConfirmButton>
              </div>
            )
          })}
        </div>
      )}
      <p className="tiny muted" style={{ margin: 0 }}>
        {hasGroup
          ? 'A gomb rögzíti az időt (a vezetők látják) és megnyitja a csoportot — az üzenet a vágólapon: hosszan nyomd a mezőt, Beillesztés, Küldés.'
          : 'A gomb rögzíti az időt (a vezetők látják) és megnyitja a WhatsAppot a kész üzenettel — válaszd ki a csoportot és küldd el.'}
      </p>
    </div>
  )
}
