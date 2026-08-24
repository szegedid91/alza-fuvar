// Geokódolás CSAK megjelenítéshez (a navigáció marad szöveges). OSM Nominatim, best-effort.
// null = a cím valóban nem található; hálózati/rate-limit hibánál DOB, hogy a
// hívó ne jelölje véglegesen "geokódolt"-nak a stopot egy átmeneti hiba miatt.
export async function geocodeAddress(addr: string): Promise<{ lat: number; lng: number } | null> {
  if (!addr.trim()) return null
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addr)}`
  const r = await fetch(url, { headers: { 'Accept-Language': 'hu' } })
  if (!r.ok) throw new Error(`Geokódolás sikertelen (HTTP ${r.status})`)
  const j = (await r.json()) as { lat: string; lon: string }[]
  if (!j[0]) return null
  return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
