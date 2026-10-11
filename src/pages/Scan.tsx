import { lazy, Suspense, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { prefetchRoute } from '../lib/routeQueries'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { useCars } from '../hooks/useCars'
import { useCarCategories } from '../hooks/useCarCategories'
import { groupByCategory } from '../lib/calendar'
import ConfirmButton from '../components/ConfirmButton'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'
import { parseCarQr } from '../lib/qr'
import { resolveCarByToken, checkInspectionRequirement, type Car, type InspectionRequirement } from '../lib/checkin'
import { getCurrentPosition, isOutsideGeofence } from '../lib/geo'
import { submitNow } from '../lib/outbox'
import { supabase } from '../lib/supabase'
import { todayISO, formatDateTime, formatHours } from '../lib/labels'

// A QR-olvasó könyvtár nagy (~300 kB) — csak a beolvasás indításakor töltődik
const QrScanner = lazy(() => import('../components/QrScanner'))

export default function Scan() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const { data: today, isLoading } = useToday()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [outBusy, setOutBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inspection, setInspection] = useState<InspectionRequirement | null>(null)

  // Napközbeni autócsere: a beolvasott új autó + a kötelező ok
  const [pendingSwitch, setPendingSwitch] = useState<{ car: Car; manual: boolean } | null>(null)
  // Kézi becsekkolás (sérült matrica / tiltott kamera): autó a listából
  const [manualOpen, setManualOpen] = useState(false)
  const [manualCarId, setManualCarId] = useState('')
  const { data: cars } = useCars(true)
  const { data: categories } = useCarCategories()
  const [switchReason, setSwitchReason] = useState('Műszaki hiba')
  const [switchNote, setSwitchNote] = useState('')

  // Nap végi kijelentkezés — rögzíti az időt, GPS-t és a geofence-jelzést
  async function checkout() {
    if (!today?.checkin) return
    setOutBusy(true)
    setError(null)
    try {
      const gps = await getCurrentPosition()
      const outside = currentWorkspace ? isOutsideGeofence(gps, currentWorkspace) : false
      await submitNow({
        id: crypto.randomUUID(),
        table: 'check_ins',
        op: 'update',
        match: { id: today.checkin.id },
        label: 'Kijelentkezés (nap vége)',
        values: {
          checked_out_at: new Date().toISOString(),
          out_gps_lat: gps.lat,
          out_gps_lng: gps.lng,
          out_outside_geofence: outside,
        },
      })
      await qc.invalidateQueries({ queryKey: ['today'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba a kijelentkezésnél')
    } finally {
      setOutBusy(false)
    }
  }

  async function handleScan(text: string) {
    setScanning(false)
    setError(null)
    const token = parseCarQr(text)
    if (!token) {
      setError('Ismeretlen QR-kód. Az autó QR-kódját olvasd be.')
      return
    }
    if (!currentWorkspaceId || !profile) return
    setBusy(true)
    try {
      const car = await resolveCarByToken(token, currentWorkspaceId)
      if (!car) {
        setError('Ehhez a QR-kódhoz nem tartozik autó ezen a munkaterületen.')
        setBusy(false)
        return
      }
      await startCheckIn(car, false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Hiba'
      setError(msg.includes('duplicate') ? 'Ma már becsekkoltál erre az autóra.' : msg)
    } finally {
      setBusy(false)
    }
  }

  // Közös belépési pont QR-ből és kézi választásból: ha ma már egy MÁSIK
  // autóra vagy becsekkolva és nem jelentkeztél ki, előbb az okot kérjük
  // (autócsere), egyébként azonnal becsekkolunk.
  async function startCheckIn(car: Car, manual: boolean) {
    const openCi = today?.checkin && !today.checkin.checked_out_at ? today.checkin : null
    if (openCi && openCi.car_id !== car.id) {
      setPendingSwitch({ car, manual })
      return
    }
    await doCheckIn(car, null, null, null, manual)
  }

  async function manualCheckIn() {
    const car = cars?.find((c) => c.id === manualCarId)
    if (!car) return
    setError(null)
    setBusy(true)
    try {
      await startCheckIn(car, true)
      setManualOpen(false)
      setManualCarId('')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Hiba'
      setError(msg.includes('duplicate') ? 'Ma már becsekkoltál erre az autóra.' : msg)
    } finally {
      setBusy(false)
    }
  }

  // Becsekkolás (normál vagy autócsere). Csere esetén a régi becsekkolást
  // lezárjuk, az újba pedig bekerül az ok és az előző autó.
  // manual: QR nélkül, listából választva — a vezetők jelzést kapnak róla.
  async function doCheckIn(car: Car, reason: string | null, prevCarId: string | null, prevCheckinId: string | null, manual = false) {
    if (!currentWorkspaceId || !profile) return
    const date = todayISO()
    const gps = await getCurrentPosition()
    const req = await checkInspectionRequirement(car.id, profile.id, date)

    // Geofence: bárhol enged, de jelzi a vezetőknek, ha nem a telephelyen történt
    const outside = currentWorkspace ? isOutsideGeofence(gps, currentWorkspace) : false

    // Ha MA már volt becsekkolás erre az autóra (visszaülés cserénél: A→B→A),
    // az egyedi (autó, ember, nap) kulcs miatt nem szúrhatunk be új sort —
    // a meglévőt nyitjuk újra.
    let existingId: string | null = null
    try {
      const { data: existing } = await supabase.from('check_ins').select('id')
        .eq('car_id', car.id).eq('user_id', profile.id).eq('work_date', date)
        .maybeSingle()
      existingId = existing?.id ?? null
    } catch { /* offline: az insert-ág megy, ütközésnél a flush jelez */ }

    if (existingId) {
      await submitNow({
        id: crypto.randomUUID(),
        table: 'check_ins',
        op: 'update',
        match: { id: existingId },
        label: `Visszaülés – ${car.plate}`,
        values: {
          checked_out_at: null,
          switch_reason: reason,
          prev_car_id: prevCarId,
          manual_checkin: manual,
        },
      })
    } else {
      const id = crypto.randomUUID()
      await submitNow({
        id,
        table: 'check_ins',
        op: 'insert',
        label: `Becsekkolás – ${car.plate}`,
        values: {
          id,
          workspace_id: currentWorkspaceId,
          car_id: car.id,
          user_id: profile.id,
          work_date: date,
          gps_lat: gps.lat,
          gps_lng: gps.lng,
          outside_geofence: outside,
          switch_reason: reason,
          prev_car_id: prevCarId,
          manual_checkin: manual,
        },
      })
    }

    // Az előző autót csak az új becsekkolás sikeres rögzítése UTÁN zárjuk le —
    // ha az új mentés elhasal, ne maradjon a munkatárs "sehova sem" becsekkolva.
    if (prevCheckinId) {
      await submitNow({
        id: crypto.randomUUID(),
        table: 'check_ins',
        op: 'update',
        match: { id: prevCheckinId },
        label: 'Autócsere — előző autó lezárása',
        values: {
          checked_out_at: new Date().toISOString(),
          out_gps_lat: gps.lat,
          out_gps_lng: gps.lng,
          out_outside_geofence: outside,
        },
      })
    }
    setInspection(req)
    await qc.invalidateQueries({ queryKey: ['today'] })
    // A mai fuvarterv előtöltése a háttérben — a Fuvar oldal azonnal nyílik
    void prefetchRoute(qc, currentWorkspaceId, car.id, date)
  }

  // Autócsere megerősítése a megadott okkal
  async function confirmSwitch() {
    if (!pendingSwitch || !today?.checkin) return
    setBusy(true)
    setError(null)
    try {
      const reason = switchNote.trim() ? `${switchReason}: ${switchNote.trim()}` : switchReason
      await doCheckIn(pendingSwitch.car, reason, today.checkin.car_id, today.checkin.id, pendingSwitch.manual)
      setPendingSwitch(null)
      setSwitchNote('')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Hiba az autócsere mentésénél'
      setError(msg.includes('duplicate') ? 'Erre az autóra ma már volt becsekkolásod — húzd le az oldalt a frissítéshez.' : msg)
    } finally {
      setBusy(false)
    }
  }

  if (scanning) {
    return (
      <Suspense fallback={<div className="camera-overlay"><div className="camera-body"><div className="spinner" /></div></div>}>
        <QrScanner onResult={handleScan} onCancel={() => setScanning(false)} />
      </Suspense>
    )
  }

  const checkedIn = !!today?.checkin
  // Mai eseményeknél elég az óra:perc — a dátum csak zaj
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="stack">
      <h2>Becsekkolás</h2>

      {isLoading && <Skeleton rows={4} />}

      {!isLoading && checkedIn && today?.car && (
        <div className="card stack primary" style={{ borderColor: 'var(--success)' }}>
          <div className="between">
            <span className="badge success"><Icon name="check" />Ma becsekkolva</span>
            <span className="small muted">{hhmm(today.checkin!.checked_in_at)}</span>
          </div>
          <div>
            <div className="muted small">Autó</div>
            <div className="num num-xl">{today.car.plate}</div>
            {today.car.label && <div className="muted small">{today.car.label}</div>}
          </div>
          <div className="divider" />
          <div>
            {/* Box (1 fős) autón nincs társ — a régi cache-ben nincs category, akkor párost mutatunk */}
            <div className="muted small" style={{ marginBottom: 6 }}>
              {today.car.category?.crew_size === 1 ? 'Ma az autón' : 'Mai páros'}
            </div>
            <div className="list">
              {today.crew.map((c) => (
                <div key={c.user_id} className="row between">
                  <span className="row" style={{ gap: 6 }}><Icon name="user" size={16} className="muted" />{c.full_name ?? 'Ismeretlen'} {c.user_id === profile?.id && <span className="tiny muted">(te)</span>}</span>
                  <span className="small muted">{hhmm(c.checked_in_at)}</span>
                </div>
              ))}
              {today.car.category?.crew_size === 1
                ? <div className="tiny muted">1 fős autó — ma egyedül dolgozol.</div>
                : today.crew.length < 2 && <div className="tiny muted">A társ még nem csekkolt be.</div>}
            </div>
          </div>
          <div className="divider" />
          {today.checkin!.checked_out_at ? (
            <div className="between">
              <span className="badge success"><Icon name="flag" />Kijelentkezve</span>
              <span className="small">
                {hhmm(today.checkin!.checked_out_at)} ·{' '}
                {formatHours(new Date(today.checkin!.checked_out_at).getTime() - new Date(today.checkin!.checked_in_at).getTime())}
              </span>
            </div>
          ) : (
            <button className="btn secondary" disabled={outBusy} onClick={() => void checkout()}>
              <Icon name="flag" />{outBusy ? 'Mentés…' : 'Kijelentkezés (nap vége)'}
            </button>
          )}
        </div>
      )}

      {inspection?.required && (
        <div className="card stack" style={{ borderColor: 'var(--warning)' }}>
          <div className="row"><Icon name="camera" size={24} style={{ color: 'var(--warning)' }} /><strong>Kötelező autó-ellenőrző fotó</strong></div>
          <p className="small muted">
            {inspection.reasons.includes('day9') && 'A hónap 9-e van. '}
            {inspection.reasons.includes('driver_change') && `Előző nap más ült az autóban${inspection.lastDriverName ? ` (${inspection.lastDriverName})` : ''}. `}
            Készíts ellenőrző fotókat (elöl/hátul/bal/jobb/beltér).
          </p>
          <button className="btn" onClick={() => navigate('/ellenorzes')}><Icon name="camera" />Ellenőrzés indítása</button>
        </div>
      )}

      {pendingSwitch && (
        <div className="card stack" style={{ borderColor: 'var(--warning)' }}>
          <div className="row"><Icon name="repeat" size={24} style={{ color: 'var(--warning)' }} /><strong>Autócsere: {today?.car?.plate} → {pendingSwitch.car.plate}</strong></div>
          <p className="small muted" style={{ margin: 0 }}>
            Ma már a(z) {today?.car?.plate} autóra vagy becsekkolva. Add meg, miért váltasz — az előző autót lezárjuk, és a vezetők értesítést kapnak.
          </p>
          <div className="field">
            <label>Ok</label>
            <select className="select" value={switchReason} onChange={(e) => setSwitchReason(e.target.value)}>
              <option>Műszaki hiba</option>
              <option>Baleset</option>
              <option>Vezetői utasítás</option>
              <option>Egyéb</option>
            </select>
          </div>
          <div className="field">
            <label>Megjegyzés (opcionális)</label>
            <input className="input" value={switchNote} onChange={(e) => setSwitchNote(e.target.value)} placeholder="pl. nem indul, hűtő hibás…" />
          </div>
          <div className="btn-grid">
            <button className="btn" disabled={busy} onClick={() => void confirmSwitch()}>
              <Icon name="repeat" />{busy ? 'Mentés…' : 'Csere megerősítése'}
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => { setPendingSwitch(null); setSwitchNote('') }}>Mégse</button>
          </div>
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      {!checkedIn && !isLoading && (
        <div className="card stack primary">
          <p className="muted small">Olvasd be az autó QR-kódját a nap kezdéséhez. A beolvasás rögzíti a ledolgozott napot (idő + GPS).</p>
          <button className="btn" onClick={() => { setError(null); setScanning(true) }} disabled={busy}>
            <Icon name="qr-code" />{busy ? 'Feldolgozás…' : 'QR beolvasása'}
          </button>
          {!manualOpen && (
            <button className="btn ghost sm" type="button" onClick={() => { setError(null); setManualOpen(true) }} disabled={busy}>
              Nem megy a beolvasás? Kézi választás
            </button>
          )}
          {manualOpen && (
            <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div className="tiny muted">
                Sérült matrica vagy tiltott kamera esetén válaszd ki az autót. A kézi becsekkolást a vezetők jelzésként látják.
              </div>
              <div className="field">
                <label>Autó</label>
                <select className="select" value={manualCarId} onChange={(e) => setManualCarId(e.target.value)}>
                  <option value="">— válassz —</option>
                  {groupByCategory(cars ?? [], categories).map((g) => (
                    <optgroup key={g.name} label={g.name}>
                      {g.cars.map((c) => <option key={c.id} value={c.id}>{c.plate}{c.label ? ` · ${c.label}` : ''}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="btn-grid">
                <button className="btn ghost sm" type="button" onClick={() => { setManualOpen(false); setManualCarId('') }}>Mégse</button>
                <ConfirmButton className="btn sm" confirmLabel="Igen, becsekkolok" disabled={!manualCarId || busy} onConfirm={() => void manualCheckIn()}>
                  {busy ? 'Feldolgozás…' : 'Becsekkolás kézzel'}
                </ConfirmButton>
              </div>
            </div>
          )}
        </div>
      )}

      {checkedIn && (
        <button className="btn secondary" onClick={() => { setError(null); setScanning(true) }} disabled={busy}>
          <Icon name="qr-code" />Másik autó beolvasása
        </button>
      )}
    </div>
  )
}
