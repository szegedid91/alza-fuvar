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
}

interface MapData {
  stops: (Stop & { _plate: string })[]
  carPositions: CarPos[]
  pendingGeocode: number
}

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
      const [carsRes, uploadsRes, checkins, inspections, cleanings, fuel, incidents] = await Promise.all([
        supabase.from('cars').select('id, plate').eq('workspace_id', ws),
        supabase.from('route_uploads').select('id, car_id').eq('workspace_id', ws).eq('work_date', today),
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
      let stops: (Stop & { _plate: string })[] = []
      if (uploads.length > 0) {
        const uploadCar = new Map(uploads.map((u) => [u.id, u.car_id]))
        const s = await fetchAll<Stop>((f, t) => supabase.from('route_stops').select('*')
          .in('upload_id', uploads.map((u) => u.id)).order('id').range(f, t))
        stops = s.map((x) => ({ ...x, _plate: plateOf.get(uploadCar.get(x.upload_id) ?? '') ?? '?' }))
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
      for (const e of events) {
        if (!e.carId || e.lat == null || e.lng == null || !e.at) continue
        const cur = latest.get(e.carId)
        if (!cur || e.at > cur.at!) latest.set(e.carId, e)
      }
      const names = await resolveNames([...latest.values()].map((e) => e.userId))
      const carPositions: CarPos[] = [...latest.entries()].map(([carId, e]) => ({
        carId, plate: plateOf.get(carId) ?? '?',
        lat: e.lat!, lng: e.lng!, at: e.at!, source: e.source,
        who: e.userId ? names[e.userId] ?? null : null,
      }))

      return { stops, carPositions, pendingGeocode: stops.filter((s) => s.lat == null && !s.geocoded).length }
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

      // Stopok: státusz-színű pöttyök
      for (const s of data.stops) {
        if (s.lat == null || s.lng == null) continue
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

      // Autók: rendszám-címke az utolsó ismert pozíción
      for (const c of data.carPositions) {
        const ageMin = (Date.now() - new Date(c.at).getTime()) / 60000
        const bg = ageMin < 45 ? '#0f766e' : ageMin < 180 ? '#b45309' : '#52525b'
        const icon = L.divIcon({
          className: 'car-pin',
          html: `<div style="background:${bg}">🚚 ${esc(c.plate)}</div>`,
          iconSize: undefined as unknown as [number, number],
          iconAnchor: [40, 14],
        })
        const when = new Date(c.at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
        L.marker([c.lat, c.lng], { icon, zIndexOffset: 1000 })
          .bindPopup(`<b>${esc(c.plate)}</b><br>${esc(c.source)} · ${when}${c.who ? `<br>👤 ${esc(c.who)}` : ''}`)
          .addTo(layer)
        bounds.push([c.lat, c.lng])
      }

      if (currentWorkspace?.geo_lat != null && currentWorkspace?.geo_lng != null) {
        bounds.push([currentWorkspace.geo_lat, currentWorkspace.geo_lng])
      }
      if (!didFitRef.current && bounds.length > 0) {
        mapRef.current!.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 })
        didFitRef.current = true
      }
    })()
  }, [mapReady, data, currentWorkspace])

  const done = (data?.stops ?? []).filter((s) => s.status === 'done').length
  const skipped = (data?.stops ?? []).filter((s) => s.status === 'skipped').length
  const total = data?.stops.length ?? 0

  return (
    <div className="stack">
      <h2>Térkép — {currentWorkspace?.name}</h2>

      {isError && <div className="alert error">A térkép-adatok betöltése nem sikerült. Frissítsd az oldalt.</div>}

      <div className="card" style={{ padding: 10 }}>
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
