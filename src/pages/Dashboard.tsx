import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { resolveNames } from '../lib/names'
import { getCurrentPosition } from '../lib/geo'
import { todayISO, formatHuf, formatDateTime, parseHuNumber } from '../lib/labels'
import { fetchAll } from '../lib/fetchAll'

// Telephely (geofence) beállítása — nem tilt, csak jelzi a kívül eső be-/kijelentkezést
function GeofenceCard() {
  const { currentWorkspaceId, currentWorkspace, reload } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [radius, setRadius] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const configured = currentWorkspace?.geo_lat != null && currentWorkspace?.geo_radius_m != null

  function openEditor() {
    setLat(currentWorkspace?.geo_lat != null ? String(currentWorkspace.geo_lat) : '')
    setLng(currentWorkspace?.geo_lng != null ? String(currentWorkspace.geo_lng) : '')
    setRadius(currentWorkspace?.geo_radius_m != null ? String(currentWorkspace.geo_radius_m) : '500')
    setOpen(true)
  }

  async function useCurrent() {
    const gps = await getCurrentPosition()
    if (gps.lat != null && gps.lng != null) { setLat(String(gps.lat)); setLng(String(gps.lng)) }
    else setMsg('Nem sikerült lekérni a pozíciót.')
  }

  async function save(clear = false) {
    if (!currentWorkspaceId) return
    const pLat = clear ? null : parseHuNumber(lat)
    const pLng = clear ? null : parseHuNumber(lng)
    const pRadius = clear ? null : Math.round(parseHuNumber(radius))
    if (!clear) {
      // "1 000" formátum is érvényes; érvénytelen bevitelből ne legyen 1 m-es sugár
      if (!Number.isFinite(pLat) || !Number.isFinite(pLng) || pLat! < -90 || pLat! > 90 || pLng! < -180 || pLng! > 180) {
        setMsg('Érvénytelen koordináta — pl. 47.4979 és 19.0402'); return
      }
      if (!Number.isFinite(pRadius) || pRadius! < 10) {
        setMsg('Érvénytelen sugár — legalább 10 méter legyen'); return
      }
    }
    setBusy(true); setMsg(null)
    const { error } = await supabase.rpc('set_workspace_geofence', {
      p_workspace_id: currentWorkspaceId,
      p_lat: pLat,
      p_lng: pLng,
      p_radius_m: pRadius,
    })
    setBusy(false)
    if (error) { setMsg('Hiba: ' + error.message); return }
    setOpen(false)
    await reload()
  }

  return (
    <div className="card stack">
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}>📍 Telephely (geofence)</div>
        {!open && <button className="btn ghost sm" onClick={openEditor}>{configured ? 'Módosítás' : 'Beállítás'}</button>}
      </div>
      {!open && (
        <div className="tiny muted">
          {configured
            ? `Beállítva · ${currentWorkspace!.geo_radius_m} m sugár. A rendszer bárhol enged be-/kijelentkezni, de jelzi, ha nem itt történt.`
            : 'Nincs beállítva — a be-/kijelentkezés helye nincs ellenőrizve.'}
        </div>
      )}
      {open && (
        <div className="stack">
          <div className="grid-2">
            <div className="field"><label>Szélesség (lat)</label><input className="input" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="47.4979" /></div>
            <div className="field"><label>Hosszúság (lng)</label><input className="input" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="19.0402" /></div>
          </div>
          <div className="field"><label>Sugár (méter)</label><input className="input" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="500" /></div>
          <button className="btn ghost sm" onClick={() => void useCurrent()}>🧭 Jelenlegi pozícióm használata</button>
          {msg && <div className="alert error">{msg}</div>}
          <div className="btn-grid">
            <button className="btn ghost sm" onClick={() => setOpen(false)}>Mégse</button>
            {configured && <button className="btn danger sm" disabled={busy} onClick={() => void save(true)}>Törlés</button>}
            <button className="btn sm" disabled={busy || !lat || !lng || !radius} onClick={() => void save()}>Mentés</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const today = todayISO()

  useRealtimeInvalidate(currentWorkspaceId, ['check_ins', 'route_stops', 'fuel_logs', 'car_inspections', 'shifts', 'car_issues'], [['dashboard']])

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', currentWorkspaceId, today],
    enabled: !!currentWorkspaceId,
    refetchInterval: 60000,
    queryFn: async () => {
      const ws = currentWorkspaceId!
      const [{ data: cars }, { data: checkins }, { data: shifts }, { data: uploads }, { data: fuel }, { data: insp }, { data: issues }] =
        await Promise.all([
          supabase.from('cars').select('id, plate, label').eq('workspace_id', ws),
          supabase.from('check_ins').select('car_id, user_id, checked_in_at, outside_geofence, out_outside_geofence').eq('workspace_id', ws).eq('work_date', today),
          supabase.from('shifts').select('car_id, driver_id, loader_id').eq('workspace_id', ws).eq('work_date', today),
          supabase.from('route_uploads').select('id, car_id').eq('workspace_id', ws).eq('work_date', today),
          supabase.from('fuel_logs').select('car_id, km_warning, odometer_km').eq('workspace_id', ws).eq('work_date', today),
          supabase.from('car_inspections').select('car_id').eq('workspace_id', ws).eq('work_date', today),
          supabase.from('car_issues').select('id, car_id, status').eq('workspace_id', ws).neq('status', 'resolved'),
        ])

      const uploadIds = (uploads ?? []).map((u) => u.id)
      let stops: { car_id: string | null; status: string; is_cash: boolean; expected_amount: number | null; received_amount: number | null; tip: number | null; upload_id: string; city: string | null }[] = []
      if (uploadIds.length > 0) {
        const s = await fetchAll((f, t) => supabase.from('route_stops')
          .select('status, is_cash, expected_amount, received_amount, tip, upload_id, city')
          .in('upload_id', uploadIds).order('id').range(f, t))
        stops = s.map((x) => ({ ...x, car_id: null }))
      }
      const uploadCar = new Map((uploads ?? []).map((u) => [u.id, u.car_id]))

      const carMap = new Map((cars ?? []).map((c) => [c.id, c]))
      const names = await resolveNames((checkins ?? []).map((c) => c.user_id))

      // per-autó összesítés
      const checkedCarIds = new Set((checkins ?? []).map((c) => c.car_id))
      const perCar = [...checkedCarIds].map((carId) => {
        const crew = (checkins ?? []).filter((c) => c.car_id === carId).map((c) => names[c.user_id] ?? '?')
        const carStops = stops.filter((s) => uploadCar.get(s.upload_id) === carId)
        const done = carStops.filter((s) => s.status !== 'pending').length
        const collected = carStops.reduce((a, s) => a + Number(s.received_amount ?? 0), 0)
        return { carId, car: carMap.get(carId), crew, doneStops: done, totalStops: carStops.length, collected }
      })

      // pénz ma
      const cashToHandOver = stops.filter((s) => s.is_cash).reduce((a, s) => a + Number(s.expected_amount ?? 0), 0)
      const collectedTotal = stops.reduce((a, s) => a + Number(s.received_amount ?? 0), 0)
      // Csak a pozitív borravaló — a kp-hiány (negatív tip) külön figyelmeztetésként jelenik meg,
      // ugyanazzal a szabállyal, mint a bérszámításban
      const tipsTotal = stops.reduce((a, s) => a + Math.max(0, Number(s.tip ?? 0)), 0)

      // figyelmeztetések
      const flags: { kind: string; text: string }[] = []
      for (const f of fuel ?? []) if (f.km_warning) flags.push({ kind: 'km', text: `Hibás km-óra: ${carMap.get(f.car_id)?.plate ?? '?'} (${f.odometer_km} km)` })
      // geofence: telephelyen kívüli be-/kijelentkezés (nem tiltott, csak jelzett)
      for (const c of checkins ?? []) {
        const who = `${names[c.user_id] ?? '?'} (${carMap.get(c.car_id)?.plate ?? '?'})`
        if (c.outside_geofence) flags.push({ kind: 'geo', text: `Telephelyen kívüli becsekkolás: ${who}` })
        if (c.out_outside_geofence) flags.push({ kind: 'geo', text: `Telephelyen kívüli kijelentkezés: ${who}` })
      }
      // nyitott autó-hibák
      if ((issues?.length ?? 0) > 0) flags.push({ kind: 'issue', text: `Nyitott autó-hiba: ${issues!.length} db` })
      for (const s of stops) if (Number(s.tip ?? 0) < 0) flags.push({ kind: 'cash', text: `Készpénz-hiány egy stopnál: ${s.city ?? ''} (${formatHuf(Number(s.tip))})` })
      // beosztva de nincs becsekkolva
      for (const sh of shifts ?? []) if (!checkedCarIds.has(sh.car_id)) flags.push({ kind: 'noshow', text: `Beosztva, de nincs becsekkolva: ${carMap.get(sh.car_id)?.plate ?? '?'}` })
      // kötelező ellenőrzés hiányzik — EGY lekérdezéssel az összes autóra (nem autónként)
      const inspCars = new Set((insp ?? []).map((i) => i.car_id))
      const carsToCheck = [...checkedCarIds].filter((id) => !inspCars.has(id))
      if (carsToCheck.length > 0) {
        const { data: prevCi, error: prevErr } = await supabase
          .from('check_ins')
          .select('car_id, user_id, work_date')
          .in('car_id', carsToCheck)
          .lt('work_date', today)
          .order('work_date', { ascending: false })
          .limit(2000)
        if (prevErr) throw prevErr
        // Autónként a legutóbbi korábbi munkanap TELJES párosa — ugyanaz a szabály,
        // mint a becsekkolési kapunál (checkin.ts): csak új ember számít váltásnak
        const prevDateByCar = new Map<string, string>()
        const prevCrewByCar = new Map<string, Set<string>>()
        for (const p of prevCi ?? []) {
          if (!prevDateByCar.has(p.car_id)) prevDateByCar.set(p.car_id, p.work_date)
          if (prevDateByCar.get(p.car_id) === p.work_date) {
            if (!prevCrewByCar.has(p.car_id)) prevCrewByCar.set(p.car_id, new Set())
            prevCrewByCar.get(p.car_id)!.add(p.user_id)
          }
        }
        const day9 = Number(today.slice(8, 10)) === 9
        for (const carId of carsToCheck) {
          const todayCrew = (checkins ?? []).filter((c) => c.car_id === carId).map((c) => c.user_id)
          if (todayCrew.length === 0) continue
          const prevCrew = prevCrewByCar.get(carId)
          const newcomer = prevCrew != null && prevCrew.size > 0 && todayCrew.some((u) => !prevCrew.has(u))
          const required = day9 || newcomer
          if (required) flags.push({ kind: 'insp', text: `Hiányzó kötelező ellenőrzés: ${carMap.get(carId)?.plate ?? '?'}` })
        }
      }

      return {
        perCar, cashToHandOver, collectedTotal, tipsTotal, flags,
        crews: perCar.length, lastCheckin: (checkins ?? []).map((c) => c.checked_in_at).sort().slice(-1)[0] ?? null,
      }
    },
  })

  return (
    <div className="stack">
      <h2>Áttekintés — {currentWorkspace?.name}</h2>
      {isLoading && <div className="card"><div className="spinner" /></div>}
      {data && (
        <>
          <div className="card">
            <div className="grid-2">
              <Stat label="Aktív párosok ma" value={String(data.crews)} />
              <Stat label="Leadandó készpénz" value={formatHuf(data.cashToHandOver)} tone="warning" />
              <Stat label="Beszedve ma" value={formatHuf(data.collectedTotal)} />
              <Stat label="Borravaló ma" value={formatHuf(data.tipsTotal)} tone="success" />
            </div>
          </div>

          {data.flags.length > 0 && (
            <div className="card stack" style={{ borderColor: 'var(--warning)' }}>
              <div className="card-title" style={{ color: 'var(--warning)' }}>⚠️ Figyelmeztetések ({data.flags.length})</div>
              {data.flags.map((f, i) => <div key={i} className="small">• {f.text}</div>)}
            </div>
          )}

          <div className="card stack">
            <div className="card-title">Ma az utakon</div>
            {data.perCar.length === 0 && <div className="tiny muted">Ma még senki nem csekkolt be.</div>}
            {data.perCar.map((c) => (
              <div key={c.carId} className="between">
                <div>
                  <div style={{ fontWeight: 700 }}>{c.car?.plate ?? '?'}</div>
                  <div className="tiny muted">{c.crew.join(' + ') || '—'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {c.totalStops > 0 && <div className="badge">{c.doneStops}/{c.totalStops} stop</div>}
                  <div className="tiny muted">{formatHuf(c.collected)}</div>
                </div>
              </div>
            ))}
          </div>

          <GeofenceCard />

          {data.lastCheckin && <div className="tiny muted" style={{ textAlign: 'center' }}>Utolsó becsekkolás: {formatDateTime(data.lastCheckin)} · élő frissítés</div>}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warning' | 'success' }) {
  const color = tone === 'warning' ? 'var(--warning)' : tone === 'success' ? 'var(--success)' : 'var(--text)'
  return (
    <div>
      <div className="tiny muted">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
    </div>
  )
}
