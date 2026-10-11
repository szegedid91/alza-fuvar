import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import RequireCheckin from '../components/RequireCheckin'
import InspectionGate from '../components/InspectionGate'
import PhotoSlot, { type CapturedPhoto } from '../components/PhotoSlot'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { supabase } from '../lib/supabase'
import { submitNow } from '../lib/outbox'
import { getCurrentPosition } from '../lib/geo'
import { ocrFuelReceipt, type OcrParsed } from '../lib/ocr'
import { previousFuelForCar, hasLaterOrEqualKm, computeConsumption, carAverageConsumption } from '../lib/fuel'
import type { Car } from '../lib/checkin'
import { formatDate, formatHuf, parseHuNumber, todayISO } from '../lib/labels'
import { toast } from '../lib/toast'
import Icon from '../components/Icon'

export default function Fuel() {
  return (
    <div className="stack">
      <h2>Tankolás</h2>
      <RequireCheckin>{({ car, date }) => (
        <InspectionGate carId={car.id} date={date}><FuelInner car={car} date={date} /></InspectionGate>
      )}</RequireCheckin>
    </div>
  )
}

// Valódi naptári dátum-e (az OCR bármit adhat — pl. "2026-24-08" a
// formátum-regexen átmenne, de az adatbázis date-oszlopa elutasítaná)
function isValidISODate(v: string | null | undefined): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T12:00:00`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

function FuelInner({ car, date }: { car: Car; date: string }) {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()

  const [photo, setPhoto] = useState<CapturedPhoto | null>(null)
  const [ocr, setOcr] = useState<{ running: boolean; raw: OcrParsed; error?: string } | null>(null)
  const [location, setLocation] = useState('')
  const [fuelDate, setFuelDate] = useState(date)
  const [amount, setAmount] = useState('')
  const [liters, setLiters] = useState('')
  const [odometer, setOdometer] = useState('')
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const { data: avg } = useQuery({ queryKey: ['fuel-avg', car.id], queryFn: () => carAverageConsumption(car.id) })
  const { data: history } = useQuery({
    queryKey: ['fuel-history', car.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('fuel_logs').select('*').eq('car_id', car.id)
        .order('fuel_date', { ascending: false }).order('created_at', { ascending: false }).limit(1)
      if (error) throw error
      return data ?? []
    },
  })

  // Versenyhelyzet-védelem: ha a sofőr új fotót készít, a lassabban visszaérő
  // KORÁBBI OCR eredménye nem írhatja felül az újét.
  const ocrSeq = useRef(0)

  async function handlePhoto(p: CapturedPhoto) {
    const seq = ++ocrSeq.current
    setPhoto(p)
    setOcr({ running: true, raw: {} })
    const res = await ocrFuelReceipt(p.blob)
    if (seq !== ocrSeq.current) return // közben új fotó készült — ez az eredmény elavult
    setOcr({ running: false, raw: res.parsed, error: res.error })
    // előtöltés – a mezők kézzel javíthatók
    if (res.parsed.location) setLocation(res.parsed.location)
    // csak érvényes ISO dátumot töltünk a date-mezőbe (az OCR bármit adhat)
    if (isValidISODate(res.parsed.date)) setFuelDate(res.parsed.date)
    if (res.parsed.amount != null) setAmount(String(res.parsed.amount))
    if (res.parsed.liters != null) setLiters(String(res.parsed.liters))
  }

  const canSave = !!photo && verified && !!odometer && !!amount && !!liters && !!fuelDate && !busy

  async function submit() {
    if (!currentWorkspaceId || !profile || !photo) return
    setBusy(true); setMsg(null)
    try {
      // Magyar formátumok ("123 456", "45,6", "25 000") helyes parsolása
      const km = parseHuNumber(odometer)
      const litersNum = parseHuNumber(liters)
      const amountNum = parseHuNumber(amount)
      if (!Number.isFinite(km) || !Number.isFinite(litersNum) || !Number.isFinite(amountNum)) {
        setMsg('Hiba: érvénytelen számérték (km / liter / összeg).')
        setBusy(false)
        return
      }

      if (!isValidISODate(fuelDate)) {
        setMsg('Hiba: érvénytelen dátum.')
        setBusy(false)
        return
      }
      const prev = await previousFuelForCar(car.id, km)
      const backwards = await hasLaterOrEqualKm(car.id, km)
      const consumption = prev && !backwards ? computeConsumption(litersNum, km, Number(prev.odometer_km)) : null
      const gps = await getCurrentPosition()

      const id = crypto.randomUUID()
      await submitNow({
        id, table: 'fuel_logs', op: 'insert', label: `Tankolás – ${car.plate}`,
        values: {
          id, workspace_id: currentWorkspaceId, car_id: car.id, user_id: profile.id, work_date: date,
          ocr_location: ocr?.raw.location ?? null,
          ocr_date: isValidISODate(ocr?.raw.date) ? ocr!.raw.date : null,
          ocr_amount: ocr?.raw.amount ?? null, ocr_liters: ocr?.raw.liters ?? null,
          location: location.trim() || null, fuel_date: fuelDate, amount: amountNum, liters: litersNum,
          odometer_km: km, consumption, km_warning: backwards, verified: true,
          gps_lat: gps.lat, gps_lng: gps.lng,
        },
        photo: { workspaceId: currentWorkspaceId, folder: 'fuel', id, column: 'photo_path', blob: photo.blob },
      })

      // A sima siker toast; a km-figyelmeztetés az űrlapnál marad, hogy látszódjon
      if (backwards) setMsg('Mentve. Figyelem: a km-óra érték nem nagyobb egy korábbinál!')
      else toast.success(`Tankolás elmentve — ${car.plate}`)
      setPhoto(null); setOcr(null); setLocation(''); setAmount(''); setLiters(''); setOdometer(''); setVerified(false)
      await qc.invalidateQueries({ queryKey: ['fuel-history', car.id] })
      await qc.invalidateQueries({ queryKey: ['fuel-avg', car.id] })
    } catch (e) {
      setMsg('Hiba: ' + (e instanceof Error ? e.message : 'ismeretlen'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="card between">
        <span className="muted small row" style={{ gap: 6 }}><Icon name="fuel" size={16} />Átlagfogyasztás — {car.plate}</span>
        <span className="num">{avg != null ? `${avg} l/100km` : <span className="muted" style={{ fontWeight: 500 }}>nincs adat</span>}</span>
      </div>

      <div className="card stack primary">
        <div className="card-title" style={{ margin: 0 }}><Icon name="camera" />Tankolós blokk — {car.plate}</div>
        <p className="tiny muted" style={{ margin: 0 }}>Fotózd le a blokkot — a hely, dátum, összeg és liter automatikusan kitöltődik, utána ellenőrizd.</p>
        <div style={{ width: 160 }}>
          <PhotoSlot label="Blokk fotózása" photo={photo} onCapture={handlePhoto} />
        </div>
        {ocr?.running && <div className="alert info row" style={{ gap: 8 }}><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />A blokk felismerése…</div>}
        {ocr && !ocr.running && ocr.error && <div className="alert error row" style={{ gap: 8 }}><Icon name="alert-circle" />A felismerés nem sikerült — töltsd ki kézzel.</div>}
        {ocr && !ocr.running && !ocr.error && <div className="alert info row" style={{ gap: 8 }}><Icon name="check-circle" />Felismerve — ellenőrizd és javítsd, ha kell.</div>}

        <div className="field">
          <label>Hely (kút)</label>
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="MOL Budapest…" />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Dátum</label>
            <input className="input" type="date" value={fuelDate} onChange={(e) => setFuelDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Összeg (Ft)</label>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25 000" />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Liter</label>
            <input className="input" inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} placeholder="45,6" />
          </div>
          <div className="field">
            <label>Km-óra állás *</label>
            <input className="input" inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="123 456" />
            {history?.[0]?.odometer_km != null && (
              <div className="tiny muted">Előző tankolásnál: {Number(history[0].odometer_km).toLocaleString('hu-HU')} km</div>
            )}
          </div>
        </div>

        <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} style={{ width: 22, height: 22 }} />
          <span className="small">Ellenőriztem, az adatok helyesek</span>
        </label>

        {msg && <div className={`alert ${msg.startsWith('Hiba') ? 'error' : msg.includes('Figyelem') ? 'warning' : 'success'}`}>{msg}</div>}
        <button className="btn" disabled={!canSave} onClick={() => void submit()}>
          <Icon name="save" />{busy ? 'Mentés…' : 'Tankolás mentése'}
        </button>
        {!canSave && !busy && (
          <p className="tiny muted" style={{ textAlign: 'center', margin: 0 }}>
            {!photo ? 'Előbb fotózd le a blokkot.' : !odometer || !amount || !liters ? 'Töltsd ki az összeget, a litert és a km-órát.' : !verified ? 'Pipáld be, hogy ellenőrizted az adatokat.' : ''}
          </p>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>A fogyasztást az előző tankolás km-állása alapján számoljuk.</p>
      </div>

      {(history?.length ?? 0) > 0 && (
        <div className="card stack">
          <div className="card-title"><Icon name="history" />Utolsó tankolás</div>
          {history!.map((f) => (
            (f.fuel_date ?? '') < todayISO() ? (
              // Korábbi napi tankolásnál csak a dátumot mutatjuk
              <div key={f.id} className="between">
                <span className="small">{formatDate(f.fuel_date)}</span>
                {f.km_warning && <span className="badge danger">km-hiba</span>}
              </div>
            ) : (
              <div key={f.id} className="between">
                <div>
                  <div className="small">{formatDate(f.fuel_date)} · {f.odometer_km} km · {f.liters} l</div>
                  <div className="tiny muted">{formatHuf(f.amount)} {f.location ? `· ${f.location}` : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {f.km_warning && <div className="badge danger">km-hiba</div>}
                  {f.consumption != null && <div className="badge">{f.consumption} l/100km</div>}
                </div>
              </div>
            )
          ))}
        </div>
      )}
    </>
  )
}
