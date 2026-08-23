export interface GeoPoint {
  lat: number | null
  lng: number | null
}

// GPS pozíció lekérése; hiba/elutasítás esetén null koordináták (nem blokkol)
export function getCurrentPosition(timeoutMs = 8000): Promise<GeoPoint> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({ lat: null, lng: null })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    )
  })
}

// Haversine-távolság méterben két koordináta között
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Geofence-en kívül van-e? (nem tilt, csak jelez; hiányzó adat esetén false)
export function isOutsideGeofence(
  gps: GeoPoint,
  geo: { geo_lat: number | null; geo_lng: number | null; geo_radius_m: number | null },
): boolean {
  if (gps.lat == null || gps.lng == null) return false
  if (geo.geo_lat == null || geo.geo_lng == null || geo.geo_radius_m == null) return false
  return distanceMeters(gps.lat, gps.lng, geo.geo_lat, geo.geo_lng) > geo.geo_radius_m
}
