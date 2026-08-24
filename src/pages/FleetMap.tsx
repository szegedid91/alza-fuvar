import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import 'leaflet/dist/leaflet.css'
import type { Map as LeafletMap, LayerGroup } from 'leaflet'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useWorkspace } from '../context/WorkspaceContext'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { resolveNames } from '../lib/names'
import { geocodeAddress, sleep } from '../lib/geocode'
import { stopAddressText } from '../lib/nav'
import { todayISO, formatHuf } from '../lib/labels'
import type { Tables } from '../lib/database.types'

type Stop = Tables<'route_stops'>

// Egy autó utolsó ismert pozíciója (a mai GPS-es eseményekből)
interface CarPos {
  carId: string
  plate: string
  lat: number
  lng: number
  at: string // timestamp
  source: string // pl. "Becsekkolás"
  who: string | null
  crew: string[] // a mai beosztás szerinti teljes legénység (sofőr + rakodó)
}

// Egy mai GPS-es esemény (az esemény-szűrőhöz)
interface MapEvent {
  carId: string
  plate: string
  userId: string | null
  who: string | null
  at: string
  lat: number
  lng: number
  source: string
}

interface MapData {
  stops: (Stop & { _plate: string; _carId: string | null })[]
  carPositions: CarPos[]
  events: MapEvent[]
  people: { id: string; name: string }[]
  personCars: Record<string, string[]> // userId -> carId-k (beosztás + események alapján)
  pendingGeocode: number
}

const EVENT_TYPES = ['Becsekkolás', 'Kijelentkezés', 'Autó-ellenőrzés', 'Takarítás', 'Tankolás', 'Esemény'] as const

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export default function FleetMap() {
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const qc = useQueryClient()
  const today = todayISO()

  useRealtimeInvalidate(currentWorkspaceId, ['check_ins', 'route_stops', 'car_inspections', 'fuel_logs'], [['fleet-map']])

  const { data, isLoading, isError } = useQuery<MapData>({
    queryKey: ['fleet-map', currentWorkspaceId, today],
    enabled: !!currentWorkspaceId,
    refetchInterval: 120_000,
    queryFn: async () => {
      const ws = currentWorkspaceId!
      const [carsRes, uploadsRes, shiftsRes, checkins, inspections, cleanings, fuel, incidents] = await Promise.all([
        supabase.from('cars').select('id, plate').eq('workspace_id', ws),
        supabase.from('route_uploads').select('id, car_id').eq('workspace_id', ws).eq('work_date', today),
        supabase.from('shifts').select('car_id, driver_id, loader_id').eq('workspace_id', ws).eq('work_date', today),
        fetchAll((f, t) => supabase.from('check_ins')
          .select('car_id, user_id, checked_in_at, checked_out_at, gps_lat, gps_lng, out_gps_lat, out_gps_lng')
          .eq('workspace_id', ws).eq('work_date', today).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('car_inspections').select('car_id, user_id, created_at, gps_lat, gps_lng')
          .eq('workspace_id', ws).eq('work_date', today).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('cleanings').select('car_id, user_id, created_at, gps_lat, gps_lng')
          .eq('workspace_id', ws).eq('work_date', today).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('fuel_logs').select('car_id, user_id, taken_at, gps_lat, gps_lng')
          .eq('workspace_id', ws).eq('work_date', today).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('incidents').select('car_id, user_id, taken_at, gps_lat, gps_lng')
          .eq('workspace_id', ws).eq('work_date', today).order('id').range(f, t)),
      ])
      if (carsRes.error) throw carsRes.error
      if (uploadsRes.error) throw uploadsRes.error
      const plateOf = new Map((carsRes.data ?? []).map((c) => [c.id, c.plate]))

      // Mai stopok (fuvartervenként), rendszámmal megcímkézve
      const uploads = uploadsRes.data ?? []
      let stops: (Stop & { _plate: string; _carId: string | null })[] = []
      if (uploads.length > 0) {
        const uploadCar = new Map(uploads.map((u) => [u.id, u.car_id]))
        const s = await fetchAll<Stop>((f, t) => supabase.from('route_stops').select('*')
          .in('upload_id', uploads.map((u) => u.id)).order('id').range(f, t))
        stops = s.map((x) => ({
          ...x,
          _plate: plateOf.get(uploadCar.get(x.upload_id) ?? '') ?? '?',
          _carId: uploadCar.get(x.upload_id) ?? null,
        }))
      }

      // Autónként a legfrissebb GPS-es esemény
      type Ev = { carId: string | null; userId: string | null; at: string | null; lat: number | null; lng: number | null; source: string }
      const events: Ev[] = [
        ...checkins.map((c) => ({ carId: c.car_id, userId: c.user_id, at: c.checked_in_at, lat: c.gps_lat, lng: c.gps_lng, source: 'Becsekkolás' })),
        ...checkins.map((c) => ({ carId: c.car_id, userId: c.user_id, at: c.checked_out_at, lat: c.out_gps_lat, lng: c.out_gps_lng, source: 'Kijelentkezés' })),
        ...inspections.map((i) => ({ carId: i.car_id, userId: i.user_id, at: i.created_at, lat: i.gps_lat, lng: i.gps_lng, source: 'Autó-ellenőrzés' })),
        ...cleanings.map((c) => ({ carId: c.car_id, userId: c.user_id, at: c.created_at, lat: c.gps_lat, lng: c.gps_lng, source: 'Takarítás' })),
        ...fuel.map((fl) => ({ carId: fl.car_id, userId: fl.user_id, at: fl.taken_at, lat: fl.gps_lat, lng: fl.gps_lng, source: 'Tankolás' })),
        ...incidents.map((i) => ({ carId: i.car_id, userId: i.user_id, at: i.taken_at, lat: i.gps_lat, lng: i.gps_lng, source: 'Esemény' })),
      ]
      const latest = new Map<string, Ev>()
      const validEvents = events.filter((e) => e.carId && e.lat != null && e.lng != null && e.at) as (Ev & { carId: string; at: string; lat: number; lng: number })[]
      for (const e of validEvents) {
        const cur = latest.get(e.carId)
        if (!cur || e.at > cur.at!) latest.set(e.carId, e)
      }

      // Nevek: az események rögzítői + a mai beosztás legénysége
      const shifts = shiftsRes.data ?? []
      const names = await resolveNames([
        ...validEvents.map((e) => e.userId),
        ...shifts.flatMap((sh) => [sh.driver_id, sh.loader_id]),
      ])

      // Mai legénység autónként (sofőr + rakodó nevek)
      const crewByCar = new Map<string, string[]>()
      const personCars: Record<string, string[]> = {}
      const addPersonCar = (uid: string | null, carId: string | null) => {
        if (!uid || !carId) return
        ;(personCars[uid] ??= []).push(carId)
      }
      for (const sh of shifts) {
        if (!sh.car_id) continue
        const crew = [sh.driver_id, sh.loader_id]
          .filter((x): x is string => !!x)
          .map((id) => names[id] ?? 'munkatárs')
        if (crew.length) crewByCar.set(sh.car_id, crew)
        addPersonCar(sh.driver_id, sh.car_id)
        addPersonCar(sh.loader_id, sh.car_id)
      }
      for (const e of validEvents) addPersonCar(e.userId, e.carId)

      const carPositions: CarPos[] = [...latest.entries()].map(([carId, e]) => ({
        carId, plate: plateOf.get(carId) ?? '?',
        lat: e.lat!, lng: e.lng!, at: e.at!, source: e.source,
        who: e.userId ? names[e.userId] ?? null : null,
        crew: crewByCar.get(carId) ?? [],
      }))

      const mapEvents: MapEvent[] = validEvents.map((e) => ({
        carId: e.carId, plate: plateOf.get(e.carId) ?? '?', userId: e.userId,
        who: e.userId ? names[e.userId] ?? null : null,
        at: e.at, lat: e.lat, lng: e.lng, source: e.source,
      }))

      // Szűrőhöz: minden ma érintett személy (beosztás + események)
      const peopleIds = new Set<string>(Object.keys(personCars))
      const people = [...peopleIds]
        .map((id) => ({ id, name: names[id] ?? 'munkatárs' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'hu'))

      return { stops, carPositions, events: mapEvents, people, personCars, pendingGeocode: stops.filter((s) => s.lat == null && !s.geocoded).length }
    },
  })

  // Hiányzó stop-koordináták geokódolása a háttérben (best-effort, DB-be cache-elve,
  // futásonként max 12 cím a Nominatim rate-limit miatt)
  const geocodingRef = useRef(false)
  useEffect(() => {
    const missing = (data?.stops ?? []).filter((s) => (s.lat == null || s.lng == null) && !s.geocoded)
    if (missing.length === 0 || geocodingRef.current) return
    geocodingRef.current = true
    void (async () => {
      try {
        for (const s of missing.slice(0, 12)) {
          const geo = await geocodeAddress(stopAddressText(s))
          if (geo) await supabase.from('route_stops').update({ lat: geo.lat, lng: geo.lng, geocoded: true }).eq('id', s.id)
          else await supabase.from('route_stops').update({ geocoded: true }).eq('id', s.id)
          await sleep(1100)
        }
        void qc.invalidateQueries({ queryKey: ['fleet-map'] })
      } finally {
        geocodingRef.current = false
      }
    })()
  }, [data, qc])

  // Szűrők: autó / ember / esemény-típus
  const [filterCar, setFilterCar] = useState('')
  const [filterPerson, setFilterPerson] = useState('')
  const [filterEvent, setFilterEvent] = useState('')

  // ---- Leaflet: a térkép egyszer jön létre, a rétegek adat-változásra frissülnek ----
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const layerRef = useRef<LayerGroup | null>(null)
  const didFitRef = useRef(false)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const L = await import('leaflet')
      if (cancelled || !containerRef.current || mapRef.current) return
      const map = L.map(containerRef.current).setView(
        [currentWorkspace?.geo_lat ?? 47.4979, currentWorkspace?.geo_lng ?? 19.0402], 11,
      )
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)
      // Telephely (geofence) kör
      if (currentWorkspace?.geo_lat != null && currentWorkspace?.geo_lng != null && currentWorkspace?.geo_radius_m != null) {
        L.circle([currentWorkspace.geo_lat, currentWorkspace.geo_lng], {
          radius: currentWorkspace.geo_radius_m, color: '#14b8a6', fillOpacity: 0.08, weight: 1.5,
        }).addTo(map).bindPopup('📍 Telephely')
      }
      layerRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      setMapReady(true)
    })()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      layerRef.current = null
      didFitRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspaceId])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !layerRef.current || !data) return
    void (async () => {
      const L = await import('leaflet')
      const layer = layerRef.current!
      layer.clearLayers()
      const bounds: [number, number][] = []

      // Szűrés: mely autók engedélyezettek (autó- és ember-szűrő szerint)
      const personCarSet = filterPerson ? new Set(data.personCars?.[filterPerson] ?? []) : null
      const carAllowed = (carId: string | null) =>
        (!filterCar || carId === filterCar) && (!personCarSet || (carId != null && personCarSet.has(carId)))

      // Stopok: státusz-színű pöttyök
      for (const s of data.stops) {
        if (s.lat == null || s.lng == null) continue
        if (!carAllowed(s._carId)) continue
        const color = s.status === 'done' ? '#22c55e' : s.status === 'skipped' ? '#ef4444' : '#f59e0b'
        L.circleMarker([s.lat, s.lng], { radius: 6, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.95 })
          .bindPopup(
            `<b>${esc(s._plate)}</b> · ${s.status === 'done' ? 'kész' : s.status === 'skipped' ? 'sikertelen' : 'hátravan'}<br>` +
            `${esc(stopAddressText(s))}` +
            (s.is_cash && s.expected_amount != null ? `<br>💵 ${esc(formatHuf(Number(s.expected_amount)))}` : ''),
          )
          .addTo(layer)
        bounds.push([s.lat, s.lng])
      }

      if (filterEvent) {
        // Esemény-szűrő: az adott típus MINDEN mai előfordulása a térképen
        for (const e of data.events ?? []) {
          if (e.source !== filterEvent) continue
          if (!carAllowed(e.carId)) continue
          if (filterPerson && e.userId !== filterPerson) continue
          const when = new Date(e.at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
          L.circleMarker([e.lat, e.lng], { radius: 8, color: '#fff', weight: 1.5, fillColor: '#8b5cf6', fillOpacity: 0.95 })
            .bindPopup(`<b>${esc(e.plate)}</b><br>${esc(e.source)} · ${when}${e.who ? `<br>👤 ${esc(e.who)}` : ''}`)
            .addTo(layer)
          bounds.push([e.lat, e.lng])
        }
      } else {
        // Autók: rendszám-címke az utolsó ismert pozíción
        for (const c of data.carPositions) {
          if (!carAllowed(c.carId)) continue
          const ageMin = (Date.now() - new Date(c.at).getTime()) / 60000
          const bg = ageMin < 45 ? '#0f766e' : ageMin < 180 ? '#b45309' : '#52525b'
          const icon = L.divIcon({
            className: 'car-pin',
            html: `<div style="background:${bg}">🚚 ${esc(c.plate)}</div>`,
            iconSize: undefined as unknown as [number, number],
            iconAnchor: [40, 14],
          })
          const when = new Date(c.at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
          const crewLine = (c.crew ?? []).length
            ? `<br>👥 ${esc((c.crew ?? []).join(' + '))}`
            : ''
          L.marker([c.lat, c.lng], { icon, zIndexOffset: 1000 })
            .bindPopup(
              `<b>${esc(c.plate)}</b>${crewLine}<br>${esc(c.source)} · ${when}${c.who ? ` — ${esc(c.who)}` : ''}`,
            )
            .addTo(layer)
          bounds.push([c.lat, c.lng])
        }
      }

      if (currentWorkspace?.geo_lat != null && currentWorkspace?.geo_lng != null) {
        bounds.push([currentWorkspace.geo_lat, currentWorkspace.geo_lng])
      }
      if (!didFitRef.current && bounds.length > 0) {
        mapRef.current!.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 })
        didFitRef.current = true
      }
    })()
  }, [mapReady, data, currentWorkspace, filterCar, filterPerson, filterEvent])

  const done = (data?.stops ?? []).filter((s) => s.status === 'done').length
  const skipped = (data?.stops ?? []).filter((s) => s.status === 'skipped').length
  const total = data?.stops.length ?? 0

  return (
    <div className="stack">
      <h2>Térkép — {currentWorkspace?.name}</h2>

      {isError && <div className="alert error">A térkép-adatok betöltése nem sikerült. Frissítsd az oldalt.</div>}

      <div className="card" style={{ padding: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <select className="select" style={{ width: 'auto', minHeight: 40, padding: '6px 10px' }} value={filterCar} onChange={(e) => setFilterCar(e.target.value)}>
            <option value="">🚚 Minden autó</option>
            {(data?.carPositions ?? []).map((c) => <option key={c.carId} value={c.carId}>{c.plate}</option>)}
          </select>
          <select className="select" style={{ width: 'auto', minHeight: 40, padding: '6px 10px' }} value={filterPerson} onChange={(e) => setFilterPerson(e.target.value)}>
            <option value="">👤 Minden munkatárs</option>
            {(data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="select" style={{ width: 'auto', minHeight: 40, padding: '6px 10px' }} value={filterEvent} onChange={(e) => setFilterEvent(e.target.value)}>
            <option value="">📌 Utolsó pozíciók</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {(filterCar || filterPerson || filterEvent) && (
            <button className="btn ghost sm" onClick={() => { setFilterCar(''); setFilterPerson(''); setFilterEvent('') }}>✕ Szűrők törlése</button>
          )}
        </div>
        <div ref={containerRef} style={{ height: 'clamp(440px, 62vh, 720px)', borderRadius: 12, overflow: 'hidden' }} />
        <div className="tiny muted" style={{ marginTop: 8 }}>
          🚚 autó (utolsó ismert pozíció ma: zöldeskék &lt;45 p, borostyán &lt;3 ó, szürke régebbi) ·{' '}
          <span style={{ color: '#22c55e' }}>●</span> kész stop ·{' '}
          <span style={{ color: '#f59e0b' }}>●</span> hátravan ·{' '}
          <span style={{ color: '#ef4444' }}>●</span> sikertelen · kör = telephely
        </div>
      </div>

      <div className="card">
        <div className="grid-2">
          <div className="between"><span className="muted small">Autók a térképen</span><span className="badge">{data?.carPositions.length ?? 0}</span></div>
          <div className="between"><span className="muted small">Mai stopok</span><span className="badge">{done}/{total} kész{skipped ? ` · ${skipped} sikertelen` : ''}</span></div>
        </div>
        {isLoading && <div className="spinner" style={{ marginTop: 8 }} />}
        {(data?.pendingGeocode ?? 0) > 0 && (
          <div className="tiny muted" style={{ marginTop: 8 }}>
            📍 {data!.pendingGeocode} stop címét még keressük a térképen — pár perc múlva megjelennek.
          </div>
        )}
        {!isLoading && total === 0 && (data?.carPositions.length ?? 0) === 0 && (
          <div className="tiny muted" style={{ marginTop: 8 }}>Ma még nincs térképre tehető adat (becsekkolás vagy fuvarterv).</div>
        )}
      </div>

      <p className="tiny muted" style={{ textAlign: 'center' }}>
        A pozíciók a munkanapi rögzítésekből származnak (becsekkolás, tankolás, stop). Az app nem követi folyamatosan a telefonokat.
      </p>
    </div>
  )
}
