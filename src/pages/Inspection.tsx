import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import RequireCheckin from '../components/RequireCheckin'
import PhotoSlot, { type CapturedPhoto } from '../components/PhotoSlot'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { supabase } from '../lib/supabase'
import { submitNow } from '../lib/outbox'
import { getCurrentPosition } from '../lib/geo'
import { checkInspectionRequirement, type Car } from '../lib/checkin'
import { inspectionViewLabel, formatDateTime } from '../lib/labels'
import { resolveNames } from '../lib/names'
import type { Enums } from '../lib/database.types'

const VIEWS: Enums<'inspection_view'>[] = ['front', 'rear', 'left', 'right', 'interior']

export default function Inspection() {
  return (
    <div className="stack">
      <h2>Autó-ellenőrzés</h2>
      <RequireCheckin>
        {({ car, date }) => <InspectionInner car={car} date={date} />}
      </RequireCheckin>
    </div>
  )
}

function InspectionInner({ car, date }: { car: Car; date: string }) {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const [photos, setPhotos] = useState<Partial<Record<Enums<'inspection_view'>, CapturedPhoto>>>({})
  const [reason, setReason] = useState<Enums<'inspection_reason'>>('manual')
  const [reasonText, setReasonText] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (profile) {
      checkInspectionRequirement(car.id, profile.id, date)
        .then((r) => {
          if (r.required) {
            setReason(r.reasons[0])
            setReasonText(
              [r.reasons.includes('day9') ? 'A hónap 9-e' : '', r.reasons.includes('driver_change') ? `Sofőrváltás${r.lastDriverName ? ` (előző: ${r.lastDriverName})` : ''}` : '']
                .filter(Boolean).join(' • '),
            )
          }
        })
        .catch(() => { /* csak a figyelmeztető sáv marad el, a mentés működik */ })
    }
  }, [car.id, profile, date])

  const allCaptured = VIEWS.every((v) => photos[v])

  async function submit() {
    if (!currentWorkspaceId || !profile || !allCaptured) return
    setBusy(true); setMsg(null)
    const inspectionId = crypto.randomUUID()
    try {
      const gps = await getCurrentPosition()
      await submitNow({
        id: inspectionId, table: 'car_inspections', op: 'insert',
        label: `Ellenőrzés – ${car.plate}`,
        values: {
          id: inspectionId, workspace_id: currentWorkspaceId, car_id: car.id,
          user_id: profile.id, work_date: date, reason, gps_lat: gps.lat, gps_lng: gps.lng,
        },
      })
      for (const view of VIEWS) {
        const p = photos[view]!
        const photoId = crypto.randomUUID()
        await submitNow({
          id: photoId, table: 'car_inspection_photos', op: 'insert',
          label: `Fotó ${inspectionViewLabel[view]} – ${car.plate}`,
          values: { id: photoId, workspace_id: currentWorkspaceId, inspection_id: inspectionId, view, gps_lat: gps.lat, gps_lng: gps.lng },
          photo: { workspaceId: currentWorkspaceId, folder: `inspections/${inspectionId}`, id: photoId, column: 'storage_path', blob: p.blob },
        })
      }
      setPhotos({})
      setMsg('Ellenőrzés elmentve.')
      await qc.invalidateQueries({ queryKey: ['inspections', car.id] })
    } catch (e) {
      // Fél-kész ellenőrzés nem maradhat: a kötelező-ellenőrzés kapu hiányos
      // fotósorral is kinyílna. A már beírt sorokat visszagörgetjük.
      try {
        await supabase.from('car_inspection_photos').delete().eq('inspection_id', inspectionId)
        await supabase.from('car_inspections').delete().eq('id', inspectionId)
      } catch { /* best effort */ }
      setMsg('Hiba: ' + (e instanceof Error ? e.message : 'ismeretlen') + ' — az ellenőrzés nem lett elmentve, próbáld újra.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {reasonText && (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          <div className="row"><span style={{ fontSize: 22 }}>⚠️</span><strong>Kötelező ellenőrzés</strong></div>
          <p className="small muted" style={{ marginTop: 6 }}>{reasonText}</p>
        </div>
      )}

      <div className="card stack">
        <div className="card-title">Ellenőrző fotók — {car.plate}</div>
        <div className="grid-3">
          {VIEWS.map((v) => (
            <PhotoSlot key={v} label={inspectionViewLabel[v]} photo={photos[v] ?? null}
              onCapture={(p) => setPhotos((prev) => ({ ...prev, [v]: p }))} />
          ))}
        </div>
        {msg && <div className={`alert ${msg.startsWith('Hiba') ? 'error' : 'success'}`}>{msg}</div>}
        <button className="btn" disabled={!allCaptured || busy} onClick={() => void submit()}>
          {busy ? 'Mentés…' : allCaptured ? 'Ellenőrzés mentése' : `Fotók: ${VIEWS.filter((v) => photos[v]).length}/5`}
        </button>
        <p className="tiny muted">Csak élő kamerával, GPS-szel és szerver-időbélyeggel rögzül. Galéria nem használható.</p>
      </div>

      <CleaningCard car={car} date={date} />
      <InspectionHistory carId={car.id} date={date} />
    </>
  )
}

function CleaningCard({ car, date }: { car: Car; date: string }) {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const { data: cleaning } = useQuery({
    queryKey: ['cleaning', car.id, date, profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data } = await supabase.from('cleanings').select('*')
        .eq('car_id', car.id).eq('work_date', date).order('created_at', { ascending: false })
      return data ?? []
    },
  })

  async function markClean() {
    if (!currentWorkspaceId || !profile) return
    setBusy(true); setErr(null)
    try {
      const gps = await getCurrentPosition()
      const id = crypto.randomUUID()
      await submitNow({
        id, table: 'cleanings', op: 'insert', label: `Takarítás – ${car.plate}`,
        values: { id, workspace_id: currentWorkspaceId, car_id: car.id, user_id: profile.id, work_date: date, done: true, gps_lat: gps.lat, gps_lng: gps.lng },
      })
      await qc.invalidateQueries({ queryKey: ['cleaning', car.id] })
    } catch (e) {
      setErr('A takarítás mentése nem sikerült: ' + (e instanceof Error ? e.message : 'ismeretlen hiba'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card stack">
      <div className="card-title">Takarítás</div>
      {err && <div className="alert error">{err}</div>}
      {(cleaning?.length ?? 0) > 0 ? (
        <div className="list">
          {cleaning!.map((c) => (
            <div key={c.id} className="between">
              <span className="badge success">✔ Kész</span>
              <span className="tiny muted">{formatDateTime(c.created_at)}</span>
            </div>
          ))}
          <button className="btn secondary sm" disabled={busy} onClick={() => void markClean()}>Újabb takarítás rögzítése</button>
        </div>
      ) : (
        <button className="btn" disabled={busy} onClick={() => void markClean()}>{busy ? 'Mentés…' : 'Takarítás kész'}</button>
      )}
    </div>
  )
}

function InspectionHistory({ carId, date }: { carId: string; date: string }) {
  const { data } = useQuery({
    queryKey: ['inspections', carId, date],
    queryFn: async () => {
      const { data } = await supabase.from('car_inspections')
        .select('*, photos:car_inspection_photos(count)')
        .eq('car_id', carId).eq('work_date', date).order('created_at', { ascending: false })
      const rows = data ?? []
      // A nevet nem profiles-joinnal kérjük: azt az RLS a munkatársak elől
      // elrejti, ezért a névfeloldó RPC-t használjuk (csak neveket ad vissza).
      const names = await resolveNames(rows.map((r) => r.user_id))
      return rows.map((r) => ({ ...r, _name: names[r.user_id] ?? null }))
    },
  })
  if (!data || data.length === 0) return null
  return (
    <div className="card stack">
      <div className="card-title">Mai ellenőrzések</div>
      {data.map((i) => {
        const cnt = (i.photos as unknown as { count: number }[] | null)?.[0]?.count ?? 0
        const name = i._name
        return (
          <div key={i.id} className="between">
            <span>{name ?? 'Ismeretlen'} · {cnt} fotó</span>
            <span className="tiny muted">{formatDateTime(i.created_at)}</span>
          </div>
        )
      })}
    </div>
  )
}
