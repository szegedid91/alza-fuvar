import type { Workspace } from '../context/WorkspaceContext'
import { DEPOT } from './relief'

// A raktár (depó) adatai a munkaterületről: a járat utolsó boxa után ide navigál a futár,
// és a mentesítő-tervező is innen számolja az oda-vissza utat. Az admin állítja a Járatok oldalon.
export type Depot = { name: string; address: string | null; lat: number; lng: number }

export function depotOf(ws: Pick<Workspace, 'depot_name' | 'depot_address' | 'depot_lat' | 'depot_lng'> | null | undefined): Depot {
  return {
    name: ws?.depot_name?.trim() || 'Alza raktár',
    address: ws?.depot_address?.trim() || null,
    lat: ws?.depot_lat ?? DEPOT.lat,
    lng: ws?.depot_lng ?? DEPOT.lng,
  }
}

// Cím → koordináta (OpenStreetMap Nominatim, böngészőből hívható; csak az admin szerkesztőben)
export async function geocode(address: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const q = encodeURIComponent(address.trim())
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=hu&q=${q}`, { headers: { Accept: 'application/json' } })
  if (!r.ok) return null
  const j = (await r.json()) as { lat: string; lon: string; display_name: string }[]
  if (!j[0]) return null
  return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), label: j[0].display_name }
}
