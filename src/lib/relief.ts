// Mentesítő járat tervezése: ha túl sok a csomag, bizonyos boxokat leveszünk a
// meglévő járatokról, és egy új, külön járatra tesszük őket. A választás a boxok
// egymáshoz és a depóhoz mért távolsága + becsült utazási idő alapján történik,
// a terheltebb járatokról elsőbbséggel. Többször is futtatható: mindig az ÖSSZES
// járat (a korábbi mentesítők is) boxait veszi számba.
//
// A távolság légvonal × úttényező, az idő átlagsebességgel + boxonkénti kiszolgálási
// idővel becsült — nem útvonaltervező, de a járatok összevetéséhez elég pontos.

export interface GeoPoint { lat: number; lng: number }
export interface ReliefStop { id: string; boxId: string; code: string | null; name: string; lat: number; lng: number }
export interface ReliefRoute { id: string; code: string; isRelief: boolean; stops: ReliefStop[] }
export interface RouteEstimate { km: number; minutes: number; stops: number }

// Az Alza-depó (HULC1) — a járatlisták innen indulnak és ide térnek vissza
export const DEPOT: GeoPoint = { lat: 47.384, lng: 19.029722 }
const ROAD_FACTOR = 1.3   // légvonal → közúti km
const SPEED_KMH = 32      // városi/elővárosi átlag
const SERVICE_MIN = 7     // egy box kiszolgálása (megállás, pakolás)

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// Depó → megállók (adott sorrendben) → depó
export function estimateRoute(stops: GeoPoint[], depot: GeoPoint = DEPOT): RouteEstimate {
  if (stops.length === 0) return { km: 0, minutes: 0, stops: 0 }
  let air = haversineKm(depot, stops[0])
  for (let i = 1; i < stops.length; i++) air += haversineKm(stops[i - 1], stops[i])
  air += haversineKm(stops[stops.length - 1], depot)
  const km = air * ROAD_FACTOR
  return { km, minutes: (km / SPEED_KMH) * 60 + stops.length * SERVICE_MIN, stops: stops.length }
}

// Sorrend: legközelebbi-szomszéd a depótól, majd 2-opt javítás
export function orderStops<T extends GeoPoint>(stops: T[], depot: GeoPoint = DEPOT): T[] {
  if (stops.length <= 2) return [...stops]
  const left = [...stops]
  const out: T[] = []
  let cur: GeoPoint = depot
  while (left.length) {
    let bi = 0, bd = Infinity
    left.forEach((p, i) => { const d = haversineKm(cur, p); if (d < bd) { bd = d; bi = i } })
    const [p] = left.splice(bi, 1)
    out.push(p); cur = p
  }
  const len = (arr: T[]) => estimateRoute(arr, depot).km
  let improved = true, best = len(out)
  while (improved) {
    improved = false
    for (let i = 0; i < out.length - 1; i++) for (let j = i + 1; j < out.length; j++) {
      const cand = [...out.slice(0, i), ...out.slice(i, j + 1).reverse(), ...out.slice(j + 1)]
      const l = len(cand)
      if (l < best - 0.01) { out.splice(0, out.length, ...cand); best = l; improved = true }
    }
  }
  return out
}

export interface ReliefPlan {
  relief: (ReliefStop & { fromRouteId: string; fromCode: string })[]  // az új járat sorrendben
  before: { id: string; code: string; est: RouteEstimate }[]
  after: { id: string; code: string; est: RouteEstimate; removed: number }[]
  reliefEst: RouteEstimate
}

// n box kiválasztása az összes járatról egy új mentesítő járatra
export function planRelief(routes: ReliefRoute[], n: number, depot: GeoPoint = DEPOT): ReliefPlan | null {
  const pool = routes.flatMap((r) => r.stops.map((s) => ({ ...s, fromRouteId: r.id, fromCode: r.code })))
  if (pool.length === 0 || n <= 0) return null
  n = Math.min(n, pool.length - 1 > 0 ? pool.length - 1 : pool.length)
  const estOf = (id: string, excluded: Set<string>) => estimateRoute(routes.find((r) => r.id === id)!.stops.filter((s) => !excluded.has(s.id)), depot)
  const before = routes.map((r) => ({ id: r.id, code: r.code, est: estimateRoute(r.stops, depot) }))
  const avgMin = before.reduce((a, b) => a + b.est.minutes, 0) / Math.max(1, before.length)

  // Mag: a legterheltebb járaton az a box, amelynek elhagyása a legtöbb percet spórolja (legnagyobb kitérő)
  const heaviest = [...before].sort((a, b) => b.est.minutes - a.est.minutes)[0]
  const heavyRoute = routes.find((r) => r.id === heaviest.id)!
  let seed = heavyRoute.stops[0]
  let bestSave = -Infinity
  for (const s of heavyRoute.stops) {
    const save = heaviest.est.minutes - estimateRoute(heavyRoute.stops.filter((x) => x.id !== s.id), depot).minutes
    if (save > bestSave) { bestSave = save; seed = s }
  }
  const chosen = new Set<string>([seed.id])
  const cluster: GeoPoint[] = [seed]
  // Növesztés: mindig az a box jön, amelyik a legközelebb van a csoport valamelyik tagjához;
  // a terheltebb járatok boxai előnyt kapnak, a már könnyű járatokról nem veszünk el többet
  while (chosen.size < n) {
    let best: (typeof pool)[number] | null = null, bestCost = Infinity
    for (const c of pool) {
      if (chosen.has(c.id)) continue
      const routeNow = estOf(c.fromRouteId, chosen).minutes
      if (routeNow < avgMin * 0.6 && before.length > 1) continue
      const d = Math.min(...cluster.map((p) => haversineKm(p, c)))
      const cost = d - 0.015 * (routeNow - avgMin)
      if (cost < bestCost) { bestCost = cost; best = c }
    }
    if (!best) break
    chosen.add(best.id); cluster.push(best)
  }
  const picked = pool.filter((p) => chosen.has(p.id))
  const relief = orderStops(picked, depot)
  const after = routes.map((r) => {
    const rest = r.stops.filter((s) => !chosen.has(s.id))
    return { id: r.id, code: r.code, est: estimateRoute(rest, depot), removed: r.stops.length - rest.length }
  })
  return { relief, before, after, reliefEst: estimateRoute(relief, depot) }
}

export function fmtMin(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return h > 0 ? `${h} ó ${m.toString().padStart(2, '0')} p` : `${m} p`
}

// Következő szabad mentesítő-kód: M1, M2, …
export function nextReliefCode(codes: string[]): string {
  let k = 1
  const set = new Set(codes.map((c) => c.toUpperCase()))
  while (set.has(`M${k}`)) k++
  return `M${k}`
}
