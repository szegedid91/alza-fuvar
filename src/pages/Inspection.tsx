import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import RequireCheckin from '../components/RequireCheckin'
import PhotoSlot, { type CapturedPhoto } from '../components/PhotoSlot'
import CameraCapture from '../components/CameraCapture'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { supabase } from '../lib/supabase'
import { submitNow, removeFromOutbox } from '../lib/outbox'
import { getCurrentPosition, type GeoPoint } from '../lib/geo'
import { uploadPhoto, recordPhotoProof } from '../lib/photos'
import { checkInspectionRequirement, type Car } from '../lib/checkin'
import { inspectionViewLabel, formatDateTime } from '../lib/labels'
import { resolveNames } from '../lib/names'
import { toast } from '../lib/toast'
import Icon from '../components/Icon'
import WaiverRequest from '../components/WaiverRequest'
import MultiShotCamera from '../components/MultiShotCamera'
import PhotoThumb from '../components/PhotoThumb'
import type { Enums, Tables } from '../lib/database.types'
import { errMsg } from '../lib/errors'

// Körbe az autón (elöl → jobb → hátul → bal), végül a fülke
const VIEWS: Enums<'inspection_view'>[] = ['front', 'right', 'rear', 'left', 'interior']

export default function Inspection() {
  return (
    <div className="stack">
      <h2>Autó-ellenőrzés</h2>
      <RequireCheckin>
        {({ car, date, checkin }) => <InspectionInner car={car} date={date} checkin={checkin} />}
      </RequireCheckin>
    </div>
  )
}

function InspectionInner({ car, date, checkin }: { car: Car; date: string; checkin: Tables<'check_ins'> }) {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  // A vezetői továbbengedés azonnal ideérjen (nem csak a 15 mp-es frissítéssel)
  useRealtimeInvalidate(currentWorkspaceId, ['check_ins'], [['today']])
  // Ha a vezető időközben fotó nélkül továbbengedett: jelzés + vissza a kezdőlapra.
  // Csak akkor, ha az engedély ITT, várakozás közben érkezett — aki engedély után
  // szándékosan nyitja meg a fotózást, az maradhat.
  const waivedAtStart = useRef(!!checkin.inspection_waived_at)
  useEffect(() => {
    if (waivedAtStart.current || !checkin.inspection_waived_at) return
    toast.success('A vezető továbbengedett fotó nélkül — a becsekkolás kész, folytathatod a napot.')
    navigate('/', { replace: true })
  }, [checkin.inspection_waived_at, navigate])
  // Becsekkolás után ide érkezik a futár: a beolvasott autó + idő látszik, és
  // azonnal indulhat a fotózás
  const fromCheckin = !!(location.state as { fromCheckin?: boolean } | null)?.fromCheckin
  const [photos, setPhotos] = useState<Partial<Record<Enums<'inspection_view'>, CapturedPhoto>>>({})
  // GYORS MENTÉS: a fotó már készítéskor, a háttérben felmegy (amíg a futár a
  // következő oldalhoz sétál), a GPS-t előre kérjük — a „Mentés” végén már csak
  // az adatbázis-sorok mennek. Nézetenként egy azonosító; újrafotózásnál ÚJ azonosító
  // jön (LOG-12), a régi fájl árván marad a tárban (a futár nem törölhet).
  const inspectionIdRef = useRef(crypto.randomUUID())
  const photoIds = useRef<Partial<Record<Enums<'inspection_view'>, string>>>({})
  const uploads = useRef<Partial<Record<Enums<'inspection_view'>, { blob: Blob; done: Promise<string | null> }>>>({})
  const [phase, setPhase] = useState<'upload' | 'rows' | null>(null)
  const gpsRef = useRef<Promise<GeoPoint> | null>(null)
  useEffect(() => { gpsRef.current = getCurrentPosition() }, [])
  const photoIdOf = (view: Enums<'inspection_view'>) => (photoIds.current[view] ??= crypto.randomUUID())
  function startUpload(view: Enums<'inspection_view'>, blob: Blob) {
    if (!currentWorkspaceId) return
    const done = navigator.onLine
      ? uploadPhoto(currentWorkspaceId, `inspections/${inspectionIdRef.current}`, photoIdOf(view), blob).catch(() => null)
      : Promise.resolve<string | null>(null)
    const entry = { blob, done }
    uploads.current[view] = entry
  }
  // Épp nyitott kamera-nézet, illetve az épp elkészült kép előnézete.
  // Sorrend: körbe az autón (elöl → jobb → hátul → bal), végül a fülke.
  // Felvétel után ELŐNÉZET jön "Újra" gombbal — homályos/rossz kép azonnal
  // újrakészíthető, nem a végén derül ki.
  const [activeView, setActiveView] = useState<Enums<'inspection_view'> | null>(null)
  const [previewView, setPreviewView] = useState<Enums<'inspection_view'> | null>(null)
  function onCaptured(blob: Blob, previewUrl: string) {
    if (!activeView) return
    // LOG-12: újrafotózásnál ÚJ azonosító (új storage-útvonal) — a még futó régi feltöltés
    // nem írhatja felül az új képet, a hash-bizonyíték a ténylegesen tárolt képről készül
    if (photos[activeView]) photoIds.current[activeView] = crypto.randomUUID()
    setPhotos((prev) => ({ ...prev, [activeView]: { blob, previewUrl } }))
    startUpload(activeView, blob)
    setPreviewView(activeView)
    setActiveView(null)
  }
  const nextMissing = (after: Enums<'inspection_view'> | null) => {
    const idx = after ? VIEWS.indexOf(after) : -1
    const ordered = [...VIEWS.slice(idx + 1), ...VIEWS.slice(0, idx + 1)]
    return ordered.find((v) => !photos[v]) ?? null
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
              [r.reasons.includes('driver_change') ? (r.lastDriverName ? `Utoljára ${r.lastDriverName} ült az autóban` : 'Sofőrváltás') : '']
                .filter(Boolean).join(' • '),
            )
          }
        })
        .catch(() => { /* csak a figyelmeztető sáv marad el, a mentés működik */ })
    }
  }, [car.id, profile, date])

  const captured = VIEWS.filter((v) => photos[v]).length
  const allCaptured = captured === VIEWS.length

  // Ma már van ellenőrzés ezen az autón? — akkor a "kötelező" sáv zöldre vált,
  // és a tankolás-kapu is nyitva van (ugyanaz a kulcs, mint a kezdőlapi lépéssoré)
  const { data: doneCount } = useQuery({
    queryKey: ['inspections-today', car.id, date],
    queryFn: async () => {
      const { count, error } = await supabase.from('car_inspections')
        .select('id', { count: 'exact', head: true }).eq('car_id', car.id).eq('work_date', date).not('completed_at', 'is', null)
      if (error) throw error
      return count ?? 0
    },
  })
  const doneToday = (doneCount ?? 0) > 0

  async function submit() {
    if (!currentWorkspaceId || !profile || !allCaptured) return
    setBusy(true); setMsg(null)
    const inspectionId = inspectionIdRef.current
    const queuedIds: string[] = [inspectionId]
    try {
      // GPS: a megnyitáskor indított kérés — többnyire már megvan, nem várunk rá 8 mp-et
      const gps = await (gpsRef.current ?? getCurrentPosition())
      // A háttérben indított feltöltések bevárása (ami kész, az azonnal; ami nem
      // sikerült vagy offline volt, azt a sor viszi fel a blobbal)
      setPhase('upload')
      const paths = await Promise.all(VIEWS.map(async (view) => {
        const u = uploads.current[view]
        return u && u.blob === photos[view]!.blob ? await u.done : null
      }))
      setPhase('rows')
      await submitNow({
        id: inspectionId, table: 'car_inspections', op: 'insert',
        label: `Ellenőrzés – ${car.plate}`,
        values: {
          id: inspectionId, workspace_id: currentWorkspaceId, car_id: car.id,
          user_id: profile.id, work_date: date, reason, gps_lat: gps.lat, gps_lng: gps.lng,
        },
      })
      const proofs: Promise<void>[] = []
      for (const [i, view] of VIEWS.entries()) {
        const p = photos[view]!
        const photoId = photoIdOf(view)
        const path = paths[i]
        queuedIds.push(photoId)
        const values: Record<string, unknown> = { id: photoId, workspace_id: currentWorkspaceId, inspection_id: inspectionId, view, gps_lat: gps.lat, gps_lng: gps.lng }
        if (path) {
          values.storage_path = path
          // Fotó-hitelesség: hash a már feltöltött képről (párhuzamosan, nem blokkol)
          proofs.push(recordPhotoProof(currentWorkspaceId, path, p.blob).catch((e) => console.error('Fotó-hash rögzítési hiba:', e)))
        }
        await submitNow({
          id: photoId, table: 'car_inspection_photos', op: 'insert',
          label: `Fotó ${inspectionViewLabel[view]} – ${car.plate}`,
          values,
          ...(path ? {} : { photo: { workspaceId: currentWorkspaceId, folder: `inspections/${inspectionId}`, id: photoId, column: 'storage_path', blob: p.blob } }),
        })
      }
      await Promise.all(proofs)
      setPhotos({})
      setMsg('Kész: az ellenőrző fotók elmentve.')
      toast.success('Becsekkolás kész — az ellenőrző fotók elmentve, jó munkát!')
      await qc.invalidateQueries({ queryKey: ['inspections', car.id] })
      await qc.invalidateQueries({ queryKey: ['inspections-today', car.id] })
      await qc.invalidateQueries({ queryKey: ['today'] })
      // A fotósor a becsekkolás utolsó lépése: innen vissza a kezdőlapra, ahol a nap többi lépése van
      navigate('/', { replace: true })
    } catch (e) {
      // Fél-kész ellenőrzés nem maradhat: a kötelező-ellenőrzés kapu hiányos
      // fotósorral is kinyílna. A már beírt sorokat visszagörgetjük.
      try {
        // A helyi sorból is ki kell venni — különben a felszinkronizálódó
        // fél-kész ellenőrzés kinyitná a kötelező-ellenőrzés kaput
        await removeFromOutbox(queuedIds)
        // Saját, fotó nélküli sor törlése (a sima DELETE csak vezetőnek szabad — ezért RPC)
        await supabase.rpc('discard_empty_inspection', { p_id: inspectionId })
      } catch { /* best effort */ }
      setMsg('Hiba: ' + (errMsg(e, 'ismeretlen')) + ' — az ellenőrzés nem lett elmentve, próbáld újra.')
    } finally {
      setBusy(false); setPhase(null)
    }
  }

  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
  const waived = !!checkin.inspection_waived_at
  const firstMissing = nextMissing(null)
  const previewPhoto = previewView ? photos[previewView] : null
  const afterPreview = previewView ? nextMissing(previewView) : null

  return (
    <>
      {fromCheckin && (
        <div className="card stack" style={{ borderColor: 'var(--success)', gap: 6 }}>
          <div className="between">
            <span className="badge success"><Icon name="qr-code" />QR beolvasva</span>
            <span className="small muted">{hhmm(checkin.checked_in_at)}</span>
          </div>
          <div className="num num-xl">{car.plate}</div>
          <div className="small muted">Következő lépés: ellenőrző fotók körbe az autón és a fülkéről.</div>
        </div>
      )}
      {!doneToday && !waived && (
        <div className="card stack" style={{ gap: 8 }}>
          {reasonText && <div className="small muted">{reasonText}.</div>}
          <WaiverRequest checkinId={checkin.id} requestedAt={checkin.inspection_help_requested_at} />
        </div>
      )}
      {!doneToday && waived && (
        <div className="card" style={{ borderColor: 'var(--primary)' }}>
          <div className="row"><Icon name="shield-check" size={22} style={{ color: 'var(--primary)' }} /><strong>Vezetői engedéllyel fotó nélkül továbbengedve</strong></div>
          <p className="small muted" style={{ marginTop: 6 }}>{hhmm(checkin.inspection_waived_at!)} — ha mégis tudsz, készítsd el a fotókat.</p>
        </div>
      )}
      {doneToday && (
        <div className="card" style={{ borderColor: 'var(--success)' }}>
          <div className="row"><Icon name="check-circle" size={22} style={{ color: 'var(--success)' }} /><strong>A mai ellenőrzés elkészült</strong></div>
          <p className="small muted" style={{ marginTop: 6 }}>{reasonText ? `${reasonText}. ` : ''}Újabb fotósort bármikor készíthetsz.</p>
        </div>
      )}

      <div className="card stack primary">
        <div className="between">
          <div className="card-title" style={{ margin: 0 }}><Icon name="camera" />Ellenőrző fotók — {car.plate}</div>
          <span className={`badge ${allCaptured ? 'success' : ''}`}>{captured}/{VIEWS.length}</span>
        </div>
        <div className="progress" style={{ marginTop: 0 }} aria-hidden="true">
          <div style={{ width: `${(captured / VIEWS.length) * 100}%` }} />
        </div>

        {previewView && previewPhoto ? (
          // Előnézet: az imént készült kép teljes szélességben — itt dől el, hogy jó-e
          <div className="stack" style={{ gap: 10 }}>
            <div className="between">
              <strong>{inspectionViewLabel[previewView]} ({VIEWS.indexOf(previewView) + 1}/{VIEWS.length})</strong>
              <span className="tiny muted">Éles? Látszik az egész?</span>
            </div>
            <img src={previewPhoto.previewUrl} alt={inspectionViewLabel[previewView]}
              style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: '#000' }} />
            <div className="btn-grid">
              <button type="button" className="btn ghost" onClick={() => { setActiveView(previewView); setPreviewView(null) }}>
                <Icon name="refresh" />Újra
              </button>
              {afterPreview ? (
                <button type="button" className="btn" onClick={() => { setPreviewView(null); setActiveView(afterPreview) }}>
                  <Icon name="arrow-right" />Jó, jöhet: {inspectionViewLabel[afterPreview]}
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => setPreviewView(null)}>
                  <Icon name="check" />Jó, kész
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {firstMissing && (
              <button type="button" className="btn" onClick={() => setActiveView(firstMissing)}>
                <Icon name="camera" />{captured === 0 ? 'Fotózás indítása' : 'Folytatás'}: {inspectionViewLabel[firstMissing]} ({VIEWS.indexOf(firstMissing) + 1}/{VIEWS.length})
              </button>
            )}
            <div className="grid-3">
              {VIEWS.map((v) => (
                <PhotoSlot key={v} label={inspectionViewLabel[v]} photo={photos[v] ?? null}
                  onOpen={() => setActiveView(v)}
                  onCapture={(p) => { setPhotos((prev) => ({ ...prev, [v]: p })); startUpload(v, p.blob) }} />
              ))}
            </div>
            <div className="tiny muted">
              {allCaptured ? 'Mind az 5 kép megvan — koppints egy képre, ha valamelyiket újra akarod csinálni.' : 'Sorban körbe az autón, a végén a fülke. Minden kép után ellenőrizheted és újra készítheted.'}
            </div>
          </>
        )}

        {msg && <div className={`alert ${msg.startsWith('Hiba') ? 'error' : 'success'}`}>{msg}</div>}
        {activeView && (
          <CameraCapture
            title={`${inspectionViewLabel[activeView]} (${VIEWS.indexOf(activeView) + 1}/${VIEWS.length})`}
            onCancel={() => setActiveView(null)}
            onCapture={onCaptured}
          />
        )}
        {!previewView && (
          <button className="btn" disabled={!allCaptured || busy} onClick={() => void submit()}
            style={allCaptured ? undefined : { opacity: 0.6 }}>
            <Icon name={allCaptured ? 'save' : 'camera'} />
            {busy ? (phase === 'upload' ? 'Fotók feltöltése…' : 'Mentés…') : allCaptured ? 'Ellenőrzés mentése' : `Még ${VIEWS.length - captured} fotó hiányzik`}
          </button>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>Csak élő kamerával, GPS-szel és szerver-időbélyeggel rögzül. Galériából nem tölthető fel, a telefonra nem mentődik.</p>
      </div>

      {/* Takarítás csak akkor, ha az ellenőrzés már megvan (vagy engedéllyel továbbengedve) */}

      {(doneToday || waived) && <CleaningCard car={car} date={date} />}
      <InspectionHistory carId={car.id} date={date} />
    </>
  )
}

// Takarítás: önálló oldalon (/takaritas) ÉS az ellenőrzés alján is elérhető.
// Az autó MAI takarításait mutatja (a társét is) — párosnál így látszik, ki csinálta.
// askPhotos: a nap végén a takarításról fotót kérünk (a rögzítés után rögtön a kamera nyílik)
export function CleaningCard({ car, date, askPhotos = false }: { car: Car; date: string; askPhotos?: boolean }) {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // fotózás ehhez a takarításhoz (null = zárva)
  const [cameraFor, setCameraFor] = useState<string | null>(null)

  const { data: cleaning } = useQuery({
    queryKey: ['cleaning', car.id, date, profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase.from('cleanings').select('*, photos:cleaning_photos(id, storage_path)')
        .eq('car_id', car.id).eq('work_date', date).order('created_at', { ascending: false })
      if (error) throw error
      const rows = (data ?? []) as (Tables<'cleanings'> & { photos: { id: string; storage_path: string }[] | null })[]
      const names = await resolveNames(rows.map((r) => r.user_id))
      return rows.map((r) => ({ ...r, _name: names[r.user_id] ?? null, photos: r.photos ?? [] }))
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
      if (askPhotos) setCameraFor(id)
    } catch (e) {
      setErr('A takarítás mentése nem sikerült: ' + (errMsg(e, 'ismeretlen hiba')))
    } finally {
      setBusy(false)
    }
  }

  // Fotók feltöltése a takarításhoz (a kamera a koppintásra nyílik; a feltöltés a háttérben)
  async function savePhotos(cleaningId: string, blobs: Blob[]) {
    if (!currentWorkspaceId || !profile) return
    setCameraFor(null); setBusy(true); setErr(null)
    try {
      for (const blob of blobs) {
        const id = crypto.randomUUID()
        const path = await uploadPhoto(currentWorkspaceId, `cleaning/${cleaningId}`, id, blob)
        const { error } = await supabase.from('cleaning_photos').insert({ id, workspace_id: currentWorkspaceId, cleaning_id: cleaningId, storage_path: path, created_by: profile.id })
        if (error) throw error
      }
      toast.success(`${blobs.length} fotó mentve a takarításhoz.`)
      await qc.invalidateQueries({ queryKey: ['cleaning', car.id] })
    } catch (e) {
      setErr('A fotó mentése nem sikerült: ' + (errMsg(e, 'ismeretlen hiba')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card stack">
      <div className="card-title"><Icon name="sparkles" />Takarítás</div>
      {err && <div className="alert error">{err}</div>}
      {cameraFor && <MultiShotCamera title="Takarítás — fotók" sendLabel="Fotók mentése" onCancel={() => setCameraFor(null)} onSend={(blobs) => void savePhotos(cameraFor, blobs)} />}
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
              <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                <span className="tiny muted">{new Date(c.created_at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}</span>
                {c.user_id === profile?.id && <button type="button" className="btn ghost sm auto" style={{ minHeight: 30, padding: '0 8px' }} disabled={busy} onClick={() => setCameraFor(c.id)}><Icon name="camera" size={14} />{c.photos.length ? '+ fotó' : 'Fotó'}</button>}
              </span>
            </div>
          ))}
          {cleaning!.some((c) => c.photos.length > 0) && (
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {cleaning!.flatMap((c) => c.photos).map((p) => <div key={p.id} style={{ width: 64 }}><PhotoThumb path={p.storage_path} /></div>)}
            </div>
          )}
          {askPhotos && cleaning!.every((c) => c.photos.length === 0) && <div className="tiny" style={{ color: 'var(--warning)' }}>Kérünk egy-két fotót a kitakarított autóról — a „Fotó” gombbal.</div>}
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
