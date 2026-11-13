import { searchBoxes, type AlzaBox } from './boxSheet'

// Box keresése a járatokban: melyik járat hanyadik címe (több járatban is lehet)
export interface RoutePlacement { route: string; index: number; total: number; eta: string | null; deadline: string | null }
export interface BoxHit { box: AlzaBox; placements: RoutePlacement[] }

export function findBoxInRoutes(
  boxes: AlzaBox[], routes: { id: string; code: string }[],
  stopsByRoute: Record<string, { box_id: string; eta: string | null; deadline: string | null }[]>,
  query: string, limit = 12,
): BoxHit[] {
  const placements = new Map<string, RoutePlacement[]>()
  for (const r of routes) {
    const stops = stopsByRoute[r.id] ?? []
    stops.forEach((s, i) => {
      if (!placements.has(s.box_id)) placements.set(s.box_id, [])
      placements.get(s.box_id)!.push({ route: r.code, index: i + 1, total: stops.length, eta: s.eta, deadline: s.deadline })
    })
  }
  const hits = searchBoxes(boxes, query, limit * 2).map((box) => ({ box, placements: placements.get(box.id) ?? [] }))
  // a járatban lévők elöl
  return hits.sort((a, b) => (b.placements.length > 0 ? 1 : 0) - (a.placements.length > 0 ? 1 : 0)).slice(0, limit)
}

// Légvonalbeli távolság a járat szakaszain: raktár → 1. box → … → utolsó box → raktár.
// legs[i] = az i. megállóhoz vezető szakasz (0 = raktárból az elsőhöz); back = vissza a raktárba; null = nincs koordináta
export interface RouteLegs { legs: (number | null)[]; back: number | null; total: number; missing: number }
export function routeLegs(stops: { lat: number | null; lng: number | null }[], depot: { lat: number | null; lng: number | null } | null, dist: (a: number, b: number, c: number, d: number) => number): RouteLegs {
  const pts: ({ lat: number; lng: number } | null)[] = stops.map((s) => (s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null))
  const d0 = depot && depot.lat != null && depot.lng != null ? { lat: depot.lat, lng: depot.lng } : null
  let total = 0, missing = 0
  const leg = (a: { lat: number; lng: number } | null, b: { lat: number; lng: number } | null): number | null => {
    if (!a || !b) { missing++; return null }
    const m = dist(a.lat, a.lng, b.lat, b.lng); total += m; return m
  }
  const legs = pts.map((p, i) => leg(i === 0 ? d0 : pts[i - 1], p))
  const back = pts.length ? leg(pts[pts.length - 1], d0) : null
  return { legs, back, total, missing }
}
