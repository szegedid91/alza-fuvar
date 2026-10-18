import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import RequireCheckin from '../components/RequireCheckin'
import PhotoSlot, { type CapturedPhoto } from '../components/PhotoSlot'
import CameraCapture from '../components/CameraCapture'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { supabase } from '../lib/supabase'
import { submitNow, removeFromOutbox } from '../lib/outbox'
import { getCurrentPosition } from '../lib/geo'
import { checkInspectionRequirement, type Car } from '../lib/checkin'
import { inspectionViewLabel, formatDateTime } from '../lib/labels'
import { resolveNames } from '../lib/names'
import { toast } from '../lib/toast'
import Icon from '../components/Icon'
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
  // Épp nyitott kamera-nézet. Felvétel után automatikusan a KÖVETKEZŐ hiányzó
  // nézet jön — nem kell minden fotó után visszalépni a rácsba és újra koppintani.
  const [activeView, setActiveView] = useState<Enums<'inspection_view'> | null>(null)
  function onCaptured(blob: Blob, previewUrl: string) {
    if (!activeView) return
    const nextPhotos = { ...photos, [activeView]: { blob, previewUrl } }
    setPhotos(nextPhotos)
    const idx = VIEWS.indexOf(activeView)
    const ordered = [...VIEWS.slice(idx + 1), ...VIEWS.slice(0, idx)]
    setActiveView(ordered.find((v) => !nextPhotos[v]) ?? null)
  }
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

  // Ma már van ellenőrzés ezen az autón? — akkor a "kötelező" sáv zöldre vált,
  // és a tankolás-kapu is nyitva van (ugyanaz a kulcs, mint a kezdőlapi lépéssoré)
  const { data: doneCount } = useQuery({
    queryKey: ['inspections-today', car.id, date],
    queryFn: async () => {
      const { count, error } = await supabase.from('car_inspections')
        .select('id', { count: 'exact', head: true }).eq('car_id', car.id).eq('work_date', date)
      if (error) throw error
      return count ?? 0
    },
  })
  const doneToday = (doneCount ?? 0) > 0

  async function submit() {
    if (!currentWorkspaceId || !profile || !allCaptured) return
    setBusy(true); setMsg(null)
    const inspectionId = crypto.randomUUID()
    const queuedIds: string[] = [inspectionId]
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
        queuedIds.push(photoId)
        await submitNow({
          id: photoId, table: 'car_inspection_photos', op: 'insert',
          label: `Fotó ${inspectionViewLabel[view]} – ${car.plate}`,
          values: { id: photoId, workspace_id: currentWorkspaceId, inspection_id: inspectionId, view, gps_lat: gps.lat, gps_lng: gps.lng },
          photo: { workspaceId: currentWorkspaceId, folder: `inspections/${inspectionId}`, id: photoId, column: 'storage_path', blob: p.blob },
        })
      }
      setPhotos({})
      toast.success('Ellenőrzés elmentve.')
      await qc.invalidateQueries({ queryKey: ['inspections', car.id] })
      await qc.invalidateQueries({ queryKey: ['inspections-today', car.id] })
    } catch (e) {
      // Fél-kész ellenőrzés nem maradhat: a kötelező-ellenőrzés kapu hiányos
      // fotósorral is kinyílna. A már beírt sorokat visszagörgetjük.
      try {
        // A helyi sorból is ki kell venni — különben a felszinkronizálódó
        // fél-kész ellenőrzés kinyitná a kötelező-ellenőrzés kaput
        await removeFromOutbox(queuedIds)
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
      {reasonText && !doneToday && (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          <div className="row"><Icon name="alert-triangle" size={22} style={{ color: 'var(--warning)' }} /><strong>Kötelező ellenőrzés</strong></div>
          <p className="small muted" style={{ marginTop: 6 }}>{reasonText} — a tankolás addig zárva.</p>
        </div>
      )}
      {reasonText && doneToday && (
        <div className="card" style={{ borderColor: 'var(--success)' }}>
          <div className="row"><Icon name="check-circle" size={22} style={{ color: 'var(--success)' }} /><strong>A mai kötelező ellenőrzés elkészült</strong></div>
          <p className="small muted" style={{ marginTop: 6 }}>{reasonText}. Újabb fotósort bármikor készíthetsz.</p>
        </div>
      )}

      <div className="card stack primary">
        <div className="between">
          <div className="card-title" style={{ margin: 0 }}><Icon name="camera" />Ellenőrző fotók — {car.plate}</div>
          <span className={`badge ${allCaptured ? 'success' : ''}`}>{VIEWS.filter((v) => photos[v]).length}/{VIEWS.length}</span>
        </div>
        <div className="progress" style={{ marginTop: 0 }} aria-hidden="true">
          <div style={{ width: `${(VIEWS.filter((v) => photos[v]).length / VIEWS.length) * 100}%` }} />
        </div>
        <div className="grid-3">
          {VIEWS.map((v) => (
            <PhotoSlot key={v} label={inspectionViewLabel[v]} photo={photos[v] ?? null}
              onOpen={() => setActiveView(v)}
              onCapture={(p) => setPhotos((prev) => ({ ...prev, [v]: p }))} />
          ))}
        </div>
        {!allCaptured && (
          <div className="tiny muted">Koppints egy nézetre — felvétel után automatikusan a következő jön.</div>
        )}
        {msg && <div className={`alert ${msg.startsWith('Hiba') ? 'error' : 'success'}`}>{msg}</div>}
        {activeView && (
          <CameraCapture
            title={`${inspectionViewLabel[activeView]} (${VIEWS.indexOf(activeView) + 1}/${VIEWS.length})`}
            onCancel={() => setActiveView(null)}
            onCapture={onCaptured}
          />
        )}
        <button className="btn" disabled={!allCaptured || busy} onClick={() => void submit()}>
          <Icon name={allCaptured ? 'check' : 'camera'} />
          {busy ? 'Mentés…' : allCaptured ? 'Ellenőrzés mentése' : `Még ${VIEWS.length - VIEWS.filter((v) => photos[v]).length} fotó hiányzik`}
        </button>
        <p className="tiny muted" style={{ margin: 0 }}>Csak élő kamerával, GPS-szel és szerver-időbélyeggel rögzül. Galéria nem használható.</p>
      </div>

      <CleaningCard car={car} date={date} />
      <InspectionHistory carId={car.id} date={date} />
    </>
  )
}

// Takarítás: önálló oldalon (/takaritas) ÉS az ellenőrzés alján is elérhető.
// Az autó MAI takarításait mutatja (a társét is) — párosnál így látszik, ki csinálta.
export function CleaningCard({ car, date }: { car: Car; date: string }) {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const { data: cleaning } = useQuery({
    queryKey: ['cleaning', car.id, date, profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase.from('cleanings').select('*')
        .eq('car_id', car.id).eq('work_date', date).order('created_at', { ascending: false })
      if (error) throw error
      const rows = data ?? []
      const names = await resolveNames(rows.map((r) => r.user_id))
      return rows.map((r) => ({ ...r, _name: names[r.user_id] ?? null }))
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
      <div className="card-title"><Icon name="sparkles" />Takarítás</div>
      {err && <div className="alert error">{err}</div>}
      {(cleaning?.length ?? 0) > 0 ? (
        <div className="list">
          {cleaning!.map((c) => (
            <div key={c.id} className="between" style={{ gap: 8 }}>
              <span className="row" style={{ gap: 8, minWidth: 0 }}>
                <span className="badge success"><Icon name="check" />Kész</span>
                <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c._name ?? 'Ismeretlen'}{c.user_id === profile?.id ? <span className="tiny muted"> (te)</span> : null}
                </span>
              </span>
              {/* mai esemény: elég az óra:perc — a dátum csak helyet foglal a név elől */}
              <span className="tiny muted" style={{ flexShrink: 0 }}>{new Date(c.created_at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))}
          <p className="tiny muted" style={{ margin: 0 }}>A vezetők a beosztás-naptárban látják, ki és mikor takarított.</p>
          <button className="btn secondary sm" disabled={busy} onClick={() => void markClean()}><Icon name="plus" />{busy ? 'Mentés…' : 'Újabb takarítás rögzítése'}</button>
        </div>
      ) : (
        <>
          <p className="tiny muted" style={{ margin: 0 }}>Ha kitakarítottad az autót, jelöld be — a vezetők a naptárban látják.</p>
          <button className="btn secondary" disabled={busy} onClick={() => void markClean()}><Icon name="sparkles" />{busy ? 'Mentés…' : 'Takarítás kész'}</button>
        </>
      )}
    </div>
  )
}

function InspectionHistory({ carId, date }: { carId: string; date: string }) {
  const { data } = useQuery({
    queryKey: ['inspections', carId, date],
    queryFn: async () => {
      const { data, error } = await supabase.from('car_inspections')
        .select('*, photos:car_inspection_photos(count)')
        .eq('car_id', carId).eq('work_date', date).order('created_at', { ascending: false })
      if (error) throw error
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
      <div className="card-title"><Icon name="check-circle" />Mai ellenőrzések</div>
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
