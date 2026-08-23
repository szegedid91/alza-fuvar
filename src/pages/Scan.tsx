import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import QrScanner from '../components/QrScanner'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { parseCarQr } from '../lib/qr'
import { resolveCarByToken, checkInspectionRequirement, type Car, type InspectionRequirement } from '../lib/checkin'
import { getCurrentPosition, isOutsideGeofence } from '../lib/geo'
import { submitNow } from '../lib/outbox'
import { todayISO, formatDateTime, formatHours } from '../lib/labels'

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
  const [pendingSwitch, setPendingSwitch] = useState<Car | null>(null)
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
      // Napközbeni autócsere: ha ma már be vagy csekkolva egy MÁSIK autóra és
      // még nem jelentkeztél ki, előbb az okot kérjük be (pl. műszaki hiba).
      const openCi = today?.checkin && !today.checkin.checked_out_at ? today.checkin : null
      if (openCi && openCi.car_id !== car.id) {
        setPendingSwitch(car)
        setBusy(false)
        return
      }
      await doCheckIn(car, null, null, null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Hiba'
      setError(msg.includes('duplicate') ? 'Ma már becsekkoltál erre az autóra.' : msg)
    } finally {
      setBusy(false)
    }
  }

  // Becsekkolás (normál vagy autócsere). Csere esetén a régi becsekkolást
  // lezárjuk, az újba pedig bekerül az ok és az előző autó.
  async function doCheckIn(car: Car, reason: string | null, prevCarId: string | null, prevCheckinId: string | null) {
    if (!currentWorkspaceId || !profile) return
    const date = todayISO()
    const gps = await getCurrentPosition()
    const req = await checkInspectionRequirement(car.id, profile.id, date)

    // Geofence: bárhol enged, de jelzi a vezetőknek, ha nem a telephelyen történt
    const outside = currentWorkspace ? isOutsideGeofence(gps, currentWorkspace) : false

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
      },
    })
    setInspection(req)
    await qc.invalidateQueries({ queryKey: ['today'] })
  }

  // Autócsere megerősítése a megadott okkal
  async function confirmSwitch() {
    if (!pendingSwitch || !today?.checkin) return
    setBusy(true)
    setError(null)
    try {
      const reason = switchNote.trim() ? `${switchReason}: ${switchNote.trim()}` : switchReason
      await doCheckIn(pendingSwitch, reason, today.checkin.car_id, today.checkin.id)
      setPendingSwitch(null)
      setSwitchNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba az autócsere mentésénél')
    } finally {
      setBusy(false)
    }
  }

  if (scanning) {
    return <QrScanner onResult={handleScan} onCancel={() => setScanning(false)} />
  }

  const checkedIn = !!today?.checkin

  return (
    <div className="stack">
      <h2>Becsekkolás</h2>

      {isLoading && <div className="card"><div className="spinner" /></div>}

      {!isLoading && checkedIn && today?.car && (
        <div className="card stack">
          <div className="between">
            <span className="badge success">✔ Ma becsekkolva</span>
            <span className="tiny muted">{formatDateTime(today.checkin!.checked_in_at)}</span>
          </div>
          <div>
            <div className="muted small">Autó</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{today.car.plate}</div>
            {today.car.label && <div className="muted small">{today.car.label}</div>}
          </div>
          <div className="divider" />
          <div>
            <div className="muted small" style={{ marginBottom: 6 }}>Mai páros</div>
            <div className="list">
              {today.crew.map((c) => (
                <div key={c.user_id} className="row between">
                  <span>{c.full_name ?? 'Ismeretlen'} {c.user_id === profile?.id && <span className="tiny muted">(te)</span>}</span>
                  <span className="tiny muted">{formatDateTime(c.checked_in_at)}</span>
                </div>
              ))}
              {today.crew.length < 2 && <div className="tiny muted">A társ még nem csekkolt be.</div>}
            </div>
          </div>
          <div className="divider" />
          {today.checkin!.checked_out_at ? (
            <div className="between">
              <span className="badge success">🏁 Kijelentkezve</span>
              <span className="small">
                {formatDateTime(today.checkin!.checked_out_at)} ·{' '}
                {formatHours(new Date(today.checkin!.checked_out_at).getTime() - new Date(today.checkin!.checked_in_at).getTime())}
              </span>
            </div>
          ) : (
            <button className="btn secondary" disabled={outBusy} onClick={() => void checkout()}>
              {outBusy ? 'Mentés…' : '🏁 Kijelentkezés (nap vége)'}
            </button>
          )}
        </div>
      )}

      {inspection?.required && (
        <div className="card stack" style={{ borderColor: 'var(--warning)' }}>
          <div className="row"><span style={{ fontSize: 24 }}>📷</span><strong>Kötelező autó-ellenőrző fotó</strong></div>
          <p className="small muted">
            {inspection.reasons.includes('day9') && 'A hónap 9-e van. '}
            {inspection.reasons.includes('driver_change') && `Előző nap más ült az autóban${inspection.lastDriverName ? ` (${inspection.lastDriverName})` : ''}. `}
            Készíts ellenőrző fotókat (elöl/hátul/bal/jobb/beltér).
          </p>
          <button className="btn" onClick={() => navigate('/ellenorzes')}>Ellenőrzés indítása</button>
        </div>
      )}

      {pendingSwitch && (
        <div className="card stack" style={{ borderColor: 'var(--warning)' }}>
          <div className="row"><span style={{ fontSize: 24 }}>🔁</span><strong>Autócsere: {today?.car?.plate} → {pendingSwitch.plate}</strong></div>
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
              {busy ? 'Mentés…' : '🔁 Csere megerősítése'}
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => { setPendingSwitch(null); setSwitchNote('') }}>Mégse</button>
          </div>
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      {!checkedIn && !isLoading && (
        <div className="card stack">
          <p className="muted small">Olvasd be az autó QR-kódját a nap kezdéséhez. A beolvasás rögzíti a ledolgozott napot (idő + GPS).</p>
          <button className="btn" onClick={() => { setError(null); setScanning(true) }} disabled={busy}>
            {busy ? 'Feldolgozás…' : '📷 QR beolvasása'}
          </button>
        </div>
      )}

      {checkedIn && (
        <button className="btn secondary" onClick={() => { setError(null); setScanning(true) }} disabled={busy}>
          Másik autó beolvasása
        </button>
      )}
    </div>
  )
}
