// Geokódolás CSAK megjelenítéshez (a navigáció marad szöveges). OSM Nominatim, best-effort.
export async function geocodeAddress(addr: string): Promise<{ lat: number; lng: number } | null> {
  if (!addr.trim()) return null
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addr)}`
    const r = await fetch(url, { headers: { 'Accept-Language': 'hu' } })
    if (!r.ok) return null
    const j = (await r.json()) as { lat: string; lon: string }[]
    if (!j[0]) return null
    return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) }
  } catch {
    return null
  }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
