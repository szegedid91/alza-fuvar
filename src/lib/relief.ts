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

// Mentesítő járat kiegyenlítéssel: a cél, hogy a járatok (az új mentesítővel együtt)
// nagyjából ugyanannyi km-t és ugyanannyi időt fussanak. A mérce a becsült idő, ami a
// km-ből és a boxok számából áll össze — így a km és az idő is kiegyenlítődik. Lépésenként
// a leghosszabb járatról vesszük le azt a boxot, amelyikkel a legnagyobb járat ideje a
// legjobban csökken, és addig folytatjuk, amíg a leghosszabb járat rövidül.
export function planRelief(routes: ReliefRoute[], maxStops = 60, depot: GeoPoint = DEPOT): ReliefPlan | null {
  const pool = routes.flatMap((r) => r.stops.map((s) => ({ ...s, fromRouteId: r.id, fromCode: r.code })))
  if (pool.length < 2 || routes.length === 0) return null
  const before = routes.map((r) => ({ id: r.id, code: r.code, est: estimateRoute(r.stops, depot) }))
  const chosen = new Set<string>()
  let relief: typeof pool = []
  let reliefKm = 0
  const kmOf = (r: ReliefRoute) => estimateRoute(r.stops.filter((s) => !chosen.has(s.id)), depot).minutes
  while (chosen.size < Math.min(maxStops, pool.length - 1)) {
    // a leghosszabb járat (a mentesítővel együtt mérve)
    const kms = routes.map((r) => ({ r, km: kmOf(r) }))
    const heaviest = kms.reduce((a, b) => (b.km > a.km ? b : a))
    const currentMax = Math.max(heaviest.km, reliefKm)
    if (reliefKm >= heaviest.km) break   // a mentesítő már a leghosszabb: tovább nem érdemes
    // Jelöltek: a leghosszabb járat boxai. Elsődleges cél a leghosszabb járat idejének csökkentése;
    // a közel egyformán jó jelöltek (4 percen belül) közül az jön, amelyik a mentesítőt a legkevésbé
    // nyújtja meg — így a mentesítő egymáshoz közeli címekből áll össze, nem szóródik szét.
    const others = Math.max(0, ...kms.filter((k) => k.r.id !== heaviest.r.id).map((k) => k.km))
    const cands: { stop: ReliefStop; newMax: number; relief: typeof pool; reliefKm: number; grow: number }[] = []
    for (const s of heaviest.r.stops) {
      if (chosen.has(s.id)) continue
      const rest = estimateRoute(heaviest.r.stops.filter((x) => !chosen.has(x.id) && x.id !== s.id), depot).minutes
      const cand = orderStops([...relief, pool.find((p) => p.id === s.id)!], depot)
      const candMin = estimateRoute(cand, depot).minutes
      cands.push({ stop: s, newMax: Math.max(rest, candMin, others), relief: cand, reliefKm: candMin, grow: candMin - reliefKm })
    }
    if (cands.length === 0) break
    const bestMax = Math.min(...cands.map((c) => c.newMax))
    if (bestMax >= currentMax - 0.5) break   // nem javít tovább (fél percnél kevesebb)
    const best = cands.filter((c) => c.newMax <= bestMax + 4).sort((a, b) => a.grow - b.grow)[0]
    chosen.add(best.stop.id); relief = best.relief; reliefKm = best.reliefKm
  }
  if (relief.length === 0) return null
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
