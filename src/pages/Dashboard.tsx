import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { resolveNames } from '../lib/names'
import { getCurrentPosition } from '../lib/geo'
import { todayISO, formatDateTime, parseHuNumber } from '../lib/labels'
import { useCrewConflicts } from '../lib/crewConflicts'
import { toast } from '../lib/toast'
import { Link } from 'react-router-dom'
import Icon, { type IconName } from '../components/Icon'
import Skeleton from '../components/Skeleton'
import ConfirmButton from '../components/ConfirmButton'

// Túl sokan egy autón (Box = 1 fő): ezt a vezetőnek kell rendeznie — vagy a
// tévesen becsekkolt embert kijelentkezteti innen, vagy a munkatárs maga vált
// autót. Amíg a nyitott becsekkolások száma a létszám fölött van, itt marad.
function CrewConflictsCard() {
  const qc = useQueryClient()
  const { data: conflicts } = useCrewConflicts()
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })

  const checkout = useMutation({
    mutationFn: async (checkinId: string) => {
      const { error } = await supabase.from('check_ins')
        .update({ checked_out_at: new Date().toISOString() })
        .eq('id', checkinId).is('checked_out_at', null)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Kijelentkeztetve — az autón maradók listája frissült.')
      void qc.invalidateQueries({ queryKey: ['crew-conflicts'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e) => toast.error('Nem sikerült: ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })

  if (!conflicts || conflicts.length === 0) return null
  return (
    <div className="card stack" style={{ borderColor: 'var(--danger)', borderWidth: 2, gap: 12 }}>
      <div className="card-title" style={{ margin: 0, color: 'var(--danger)' }}>
        <Icon name="users" />Megoldandó: túl sokan egy autón ({conflicts.length})
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        Több nyitott becsekkolás van, mint ahány fős az autó. Aki valójában nem ezen dolgozik, azt jelentkeztesd ki itt — vagy ő váltson át a saját autójára a Becsekkolás oldalon.
      </p>
      {conflicts.map((c) => (
        <div key={c.carId} className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div className="between">
            <span className="num" style={{ fontSize: 16 }}>{c.plate}</span>
            <span className="badge danger">{c.people.length} fő · {c.capacity} fős{c.category ? ` (${c.category})` : ''}</span>
          </div>
          {c.people.map((p) => (
            <div key={p.checkinId} className="stack" style={{ gap: 4 }}>
              <div className="between" style={{ gap: 8 }}>
                <span className="small row" style={{ gap: 6, minWidth: 0, fontWeight: 600 }}>
                  <Icon name="user" size={14} className="muted" />{p.name}
                </span>
                <span className="tiny muted" style={{ flexShrink: 0 }}>{hhmm(p.checkedInAt)}</span>
              </div>
              <div className="between" style={{ gap: 8 }}>
                <span className="tiny muted">{p.flagged ? 'A figyelmeztetés ellenére csekkolt be' : 'Előbb volt az autón'}</span>
                <ConfirmButton className="btn danger-outline sm" confirmLabel="Biztos? Igen" disabled={checkout.isPending}
                  onConfirm={() => checkout.mutate(p.checkinId)}>
                  <Icon name="log-out" size={14} />Kijelentkeztetés
                </ConfirmButton>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// Figyelmeztetés-fajták ikonja és (ha van) a részletező oldal
const FLAG_META: Record<string, { icon: IconName; to?: string }> = {
  km: { icon: 'fuel' }, geo: { icon: 'map-pin' }, issue: { icon: 'wrench', to: '/hibak' },
  noshow: { icon: 'user' }, insp: { icon: 'camera' }, manual: { icon: 'pencil' },
}

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
    // A geofence TÖRLÉSE null értékekkel történik (a függvény elfogadja),
    // a generált típus viszont csak number-t ismer — ezért a cast
    const { error } = await supabase.rpc('set_workspace_geofence', {
      p_workspace_id: currentWorkspaceId,
      p_lat: pLat,
      p_lng: pLng,
      p_radius_m: pRadius,
    } as unknown as { p_workspace_id: string; p_lat: number; p_lng: number; p_radius_m: number })
    setBusy(false)
    if (error) { setMsg('Hiba: ' + error.message); return }
    setOpen(false)
    await reload()
  }

  return (
    <div className="card stack">
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}><Icon name="map-pin" />Telephely (geofence)</div>
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
          <button className="btn ghost sm" onClick={() => void useCurrent()}><Icon name="navigation" />Jelenlegi pozícióm használata</button>
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

  useRealtimeInvalidate(currentWorkspaceId, ['check_ins', 'fuel_logs', 'car_inspections', 'shifts', 'car_issues'], [['dashboard'], ['crew-conflicts']])

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', currentWorkspaceId, today],
    enabled: !!currentWorkspaceId,
    refetchInterval: 60000,
    queryFn: async () => {
      const ws = currentWorkspaceId!
      const [{ data: cars }, { data: checkins }, { data: shifts }, { data: fuel }, { data: insp }, { data: issues }] =
        await Promise.all([
          supabase.from('cars').select('id, plate, label').eq('workspace_id', ws),
          supabase.from('check_ins').select('car_id, user_id, checked_in_at, outside_geofence, out_outside_geofence, manual_checkin').eq('workspace_id', ws).eq('work_date', today),
          supabase.from('shifts').select('car_id, driver_id, loader_id').eq('workspace_id', ws).eq('work_date', today),
          supabase.from('fuel_logs').select('car_id, km_warning, odometer_km').eq('workspace_id', ws).eq('work_date', today),
          supabase.from('car_inspections').select('car_id').eq('workspace_id', ws).eq('work_date', today),
          supabase.from('car_issues').select('id, car_id, status').eq('workspace_id', ws).neq('status', 'resolved'),
        ])

      const carMap = new Map((cars ?? []).map((c) => [c.id, c]))
      const names = await resolveNames((checkins ?? []).map((c) => c.user_id))
      const inspCars = new Set((insp ?? []).map((i) => i.car_id))

      // per-autó összesítés: ki ül rajta, nyitott hiba, mai ellenőrzés / tankolás
      const checkedCarIds = new Set((checkins ?? []).map((c) => c.car_id))
      const perCar = [...checkedCarIds].map((carId) => {
        const crew = (checkins ?? []).filter((c) => c.car_id === carId).map((c) => names[c.user_id] ?? '?')
        const openIssues = (issues ?? []).filter((i) => i.car_id === carId).length
        const fueled = (fuel ?? []).some((f) => f.car_id === carId)
        return { carId, car: carMap.get(carId), crew, openIssues, inspected: inspCars.has(carId), fueled }
      })

      // figyelmeztetések
      const flags: { kind: string; text: string }[] = []
      for (const f of fuel ?? []) if (f.km_warning) flags.push({ kind: 'km', text: `Hibás km-óra: ${carMap.get(f.car_id)?.plate ?? '?'} (${f.odometer_km} km)` })
      // geofence: telephelyen kívüli be-/kijelentkezés (nem tiltott, csak jelzett)
      for (const c of checkins ?? []) {
        const who = `${names[c.user_id] ?? '?'} (${carMap.get(c.car_id)?.plate ?? '?'})`
        if (c.outside_geofence) flags.push({ kind: 'geo', text: `Telephelyen kívüli becsekkolás: ${who}` })
        if (c.out_outside_geofence) flags.push({ kind: 'geo', text: `Telephelyen kívüli kijelentkezés: ${who}` })
        if (c.manual_checkin) flags.push({ kind: 'manual', text: `Kézi becsekkolás (QR nélkül): ${who}` })
      }
      // nyitott autó-hibák
      if ((issues?.length ?? 0) > 0) flags.push({ kind: 'issue', text: `Nyitott autó-hiba: ${issues!.length} db` })
      // beosztva de nincs becsekkolva
      for (const sh of shifts ?? []) if (!checkedCarIds.has(sh.car_id)) flags.push({ kind: 'noshow', text: `Beosztva, de nincs becsekkolva: ${carMap.get(sh.car_id)?.plate ?? '?'}` })
      // kötelező ellenőrzés hiányzik — EGY lekérdezéssel az összes autóra (nem autónként)
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
        perCar, flags,
        crews: perCar.length, openIssues: issues?.length ?? 0, fuelToday: fuel?.length ?? 0, inspToday: inspCars.size,
        lastCheckin: (checkins ?? []).map((c) => c.checked_in_at).sort().slice(-1)[0] ?? null,
      }
    },
  })

  return (
    <div className="stack">
      <h2>Áttekintés — {currentWorkspace?.name}</h2>
      <CrewConflictsCard />
      {isLoading && <><Skeleton rows={2} /><Skeleton rows={3} /></>}
      {data && (
        <>
          <div className="card primary">
            <div className="grid-2">
              <Stat label="Aktív párosok ma" value={String(data.crews)} />
              <Stat label="Nyitott autó-hiba" value={String(data.openIssues)} tone={data.openIssues > 0 ? 'warning' : undefined} />
              <Stat label="Mai ellenőrzés" value={String(data.inspToday)} tone={data.inspToday > 0 ? 'success' : undefined} />
              <Stat label="Mai tankolás" value={String(data.fuelToday)} />
            </div>
          </div>

          {data.flags.length > 0 && (
            <div className="card stack" style={{ borderColor: 'var(--warning)', gap: 10 }}>
              <div className="card-title" style={{ margin: 0 }}><Icon name="alert-triangle" style={{ color: 'var(--warning)' }} />Figyelmeztetések ({data.flags.length})</div>
              {data.flags.map((f, i) => {
                const meta = FLAG_META[f.kind] ?? { icon: 'alert-circle' as IconName }
                const row = (
                  <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <Icon name={meta.icon} size={18} style={{ color: 'var(--warning)', marginTop: 1 }} />
                    <span className="small" style={{ flex: 1 }}>{f.text}</span>
                    {meta.to && <Icon name="chevron-right" size={16} className="muted" />}
                  </div>
                )
                return meta.to
                  ? <Link key={i} to={meta.to} style={{ textDecoration: 'none', color: 'inherit' }}>{row}</Link>
                  : <div key={i}>{row}</div>
              })}
            </div>
          )}

          <div className="card stack">
            <div className="card-title" style={{ margin: 0 }}><Icon name="truck" />Ma az utakon</div>
            {data.perCar.length === 0 && (
              <div className="empty" style={{ padding: '20px 8px' }}>
                <span className="ico"><Icon name="truck" size={32} /></span>
                <span className="small">Ma még senki nem csekkolt be.</span>
              </div>
            )}
            {data.perCar.map((c) => (
              <div key={c.carId} className="between" style={{ gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="num" style={{ fontSize: 16 }}>{c.car?.plate ?? '?'}</div>
                  <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.crew.join(' + ') || '—'}</div>
                </div>
                <div className="row" style={{ gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {c.openIssues > 0 && <Link to="/hibak" className="badge warning" style={{ textDecoration: 'none' }}><Icon name="wrench" size={12} />{c.openIssues} hiba</Link>}
                  {c.inspected && <span className="badge success"><Icon name="camera" size={12} />ellenőrizve</span>}
                  {c.fueled && <span className="badge"><Icon name="fuel" size={12} />tankolt</span>}
                  {c.openIssues === 0 && !c.inspected && !c.fueled && <span className="tiny muted">nincs mai esemény</span>}
                </div>
              </div>
            ))}
          </div>

          <GeofenceCard />

          {data.lastCheckin && (
            <div className="tiny muted row" style={{ justifyContent: 'center', gap: 6 }}>
              <Icon name="clock" size={14} />Utolsó becsekkolás: {formatDateTime(data.lastCheckin)} · élő frissítés
            </div>
          )}
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
      <div className="num num-lg" style={{ color }}>{value}</div>
    </div>
  )
}
