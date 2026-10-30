// A csütörtöki járatterv (Alza xlsx: „Routes” + „RouteDetails” lapok) beolvasása.
// Járatonként a boxok sorrendje, tervezett érkezés (ETA) / indulás (ETD) és a
// határidő („Korekce času” – eddig kell végezni a boxban), koordinátával.
export type PlanStop = {
  order: number; code: string; name: string; address: string | null
  lat: number | null; lng: number | null
  eta: string | null; etd: string | null; deadline: string | null
}
export type PlanRoute = {
  vehicle: string; code: string
  start: string | null; end: string | null; distanceKm: number | null
  stops: PlanStop[]
}

// Excel időtört (0.229 = 05:30) vagy "HH:MM" szöveg → "HH:MM"
export function excelTime(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    const mins = Math.round((v % 1) * 1440) % 1440
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
  }
  if (v instanceof Date) return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

// „Budapest G” → „G” (a járat kódja az utolsó szó)
export function routeCodeOf(vehicle: string): string {
  const parts = vehicle.trim().split(/\s+/)
  return (parts[parts.length - 1] ?? vehicle).toUpperCase()
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null)

function findCol(header: unknown[], ...patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = header.findIndex((h) => typeof h === 'string' && p.test(h.trim()))
    if (i >= 0) return i
  }
  return -1
}

export async function parseRoutePlan(file: File): Promise<PlanRoute[]> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  // a részletező lap: ahol van „Vehicle” és „ETA” fejléc
  let details: unknown[][] | null = null
  let routesSheet: unknown[][] | null = null
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null })
    const head = (rows[0] ?? []) as unknown[]
    if (!details && findCol(head, /^vehicle$/i) >= 0 && findCol(head, /^eta$/i) >= 0) details = rows
    else if (!routesSheet && findCol(head, /vozidla|vehicle id|járat/i) >= 0 && findCol(head, /za[čc][aá]tek|start|kezd/i) >= 0) routesSheet = rows
  }
  if (!details) throw new Error('Nem találom a „RouteDetails” lapot (Vehicle, ETA, ETD, Identifikátor Zakázky oszlopokkal).')
  const h = details[0] as unknown[]
  const cVeh = findCol(h, /^vehicle$/i), cOrd = findCol(h, /po[řr]ad[ií]|order|sorrend/i), cEta = findCol(h, /^eta$/i), cEtd = findCol(h, /^etd$/i)
  const cDl = findCol(h, /korekce|deadline|hat[aá]rid/i), cCode = findCol(h, /identifik|zak[aá]zk|box|k[oó]d/i), cName = findCol(h, /zast[aá]vka|stop|meg[aá]ll/i)
  const cAddr = findCol(h, /adres|address|c[ií]m/i), cLng = findCol(h, /^x\b|d[eé]lka|lng|lon/i), cLat = findCol(h, /^y\b|[šs][ií][řr]ka|lat/i)
  if (cVeh < 0 || cCode < 0) throw new Error('Hiányzik a Vehicle vagy az Identifikátor Zakázky oszlop.')

  const byVehicle = new Map<string, PlanRoute>()
  for (const row of details.slice(1)) {
    const vehicle = str(row[cVeh]); if (!vehicle) continue
    let r = byVehicle.get(vehicle)
    if (!r) { r = { vehicle, code: routeCodeOf(vehicle), start: null, end: null, distanceKm: null, stops: [] }; byVehicle.set(vehicle, r) }
    const code = str(row[cCode])
    if (!code) {
      // kezdő / záró sor (depó): az ETA az indulás, illetve a visszaérkezés
      const t = excelTime(row[cEta])
      if (r.stops.length === 0 && !r.start) r.start = t; else r.end = t
      continue
    }
    const order = num(cOrd >= 0 ? row[cOrd] : null) ?? r.stops.length + 1
    r.stops.push({
      order, code: code.toUpperCase().replace(/\s+/g, ''),
      name: (str(cName >= 0 ? row[cName] : null) ?? code).replace(/^\*\s*/, ''),
      address: str(cAddr >= 0 ? row[cAddr] : null),
      lat: num(cLat >= 0 ? row[cLat] : null), lng: num(cLng >= 0 ? row[cLng] : null),
      eta: excelTime(cEta >= 0 ? row[cEta] : null), etd: excelTime(cEtd >= 0 ? row[cEtd] : null), deadline: excelTime(cDl >= 0 ? row[cDl] : null),
    })
  }
  // összefoglaló lap: tervezett kezdés / vége / km, ha van
  if (routesSheet) {
    const rh = routesSheet[0] as unknown[]
    const cV = findCol(rh, /vozidla|vehicle|járat/i), cS = findCol(rh, /za[čc][aá]tek|start|kezd/i), cE = findCol(rh, /konec|end|v[eé]g/i), cKm = findCol(rh, /vzd[aá]lenost|distance|km/i)
    for (const row of routesSheet.slice(1)) {
      const v = str(row[cV]); if (!v) continue
      const r = byVehicle.get(v); if (!r) continue
      r.start = excelTime(cS >= 0 ? row[cS] : null) ?? r.start
      r.end = excelTime(cE >= 0 ? row[cE] : null) ?? r.end
      r.distanceKm = num(cKm >= 0 ? row[cKm] : null)
    }
  }
  const routes = [...byVehicle.values()].filter((r) => r.stops.length > 0)
  for (const r of routes) r.stops.sort((a, b) => a.order - b.order)
  if (routes.length === 0) throw new Error('A fájlban nincs egyetlen járat sem boxokkal.')
  return routes
}

// "HH:MM[:SS]" → perc éjféltől; a késés-számításhoz
export function timeToMin(t: string | null | undefined): number | null {
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null
}
export function fmtTime(t: string | null | undefined): string | null { return t ? t.slice(0, 5) : null }
export function nowMin(): number { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }
