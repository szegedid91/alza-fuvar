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
  // csak a járatainkon lévő boxok közt keresünk — a jegyzék többi (idegen) boxa nem érdekes itt
  const ours = boxes.filter((b) => placements.has(b.id))
  return searchBoxes(ours, query, limit).map((box) => ({ box, placements: placements.get(box.id) ?? [] }))
}
