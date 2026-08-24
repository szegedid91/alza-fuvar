import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import type { Map as LeafletMap } from 'leaflet'
import { supabase } from '../lib/supabase'
import { geocodeAddress, sleep } from '../lib/geocode'
import { stopAddressText } from '../lib/nav'
import type { Tables } from '../lib/database.types'

type Stop = Tables<'route_stops'>

// Stopok térképen (Leaflet + OSM). Geokódolás best-effort, DB-be cache-elve.
// Az Excelből jövő cím szöveg — HTML-ként beszúrni tilos (tárolt XSS lenne)
function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export default function RouteMap({ stops }: { stops: Stop[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<string>('Térkép betöltése…')

  useEffect(() => {
    let cancelled = false
    let map: LeafletMap | null = null

    async function run() {
      const L = await import('leaflet')
      if (cancelled || !containerRef.current) return

      map = L.map(containerRef.current).setView([47.4979, 19.0402], 11) // Budapest alap
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map)

      // geokódolás a hiányzó pontokra (egyszer, cache DB-be)
      const located: { stop: Stop; lat: number; lng: number }[] = []
      let needGeocode = stops.filter((s) => s.lat == null || s.lng == null)
      for (const s of stops) {
        if (s.lat != null && s.lng != null) located.push({ stop: s, lat: s.lat, lng: s.lng })
      }
      if (needGeocode.length > 0) setStatus(`Címek keresése… (${needGeocode.length})`)
      for (const s of needGeocode) {
        if (cancelled) return
        const addr = stopAddressText(s)
        const geo = await geocodeAddress(addr)
        if (geo) {
          located.push({ stop: s, lat: geo.lat, lng: geo.lng })
          void supabase.from('route_stops').update({ lat: geo.lat, lng: geo.lng, geocoded: true }).eq('id', s.id)
        } else {
          void supabase.from('route_stops').update({ geocoded: true }).eq('id', s.id)
        }
        await sleep(1100) // Nominatim rate limit
      }

      if (cancelled || !map) return
      setStatus(located.length === 0 ? 'Egyetlen címet sem sikerült térképre tenni.' : '')

      const bounds: [number, number][] = []
      located
        .sort((a, b) => (a.stop.display_order ?? 0) - (b.stop.display_order ?? 0))
        .forEach((item, i) => {
          const color = item.stop.status === 'done' ? '#22c55e' : item.stop.status === 'skipped' ? '#ef4444' : '#14b8a6'
          const icon = L.divIcon({
            className: 'route-pin',
            html: `<div style="background:${color}">${i + 1}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          })
          L.marker([item.lat, item.lng], { icon })
            .addTo(map!)
            .bindPopup(`<b>${i + 1}.</b> ${esc(stopAddressText(item.stop))}`)
          bounds.push([item.lat, item.lng])
        })
      if (bounds.length > 0) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 })
    }

    void run()
    return () => {
      cancelled = true
      map?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="card" style={{ padding: 10 }}>
      {status && <div className="small muted" style={{ marginBottom: 8 }}>{status}</div>}
      <div ref={containerRef} style={{ height: 360, borderRadius: 12, overflow: 'hidden' }} />
      <p className="tiny muted" style={{ marginTop: 8 }}>A térkép csak tájékoztató. A navigációhoz használd a stop „Navigáció" gombját.</p>
    </div>
  )
}
