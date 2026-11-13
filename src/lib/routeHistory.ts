// Járatterv-verziók összevetése: feltöltésről feltöltésre mi változott (boxok, áthelyezés, sorrend, idők).
export interface VersionStop { box_id: string | null; code: string | null; name: string | null; eta: string | null; etd: string | null; deadline: string | null }
export interface PlanVersion { id: string; route_id: string | null; code: string; source: string | null; imported_at: string; imported_by: string | null; planned_start: string | null; planned_end: string | null; stops: VersionStop[] }

// Egy feltöltés = az ugyanazzal a forrással, egymáshoz közel (10 percen belül) betöltött járat-verziók
export interface Upload { key: string; at: string; source: string | null; by: string | null; routes: PlanVersion[] }
export function groupUploads(versions: PlanVersion[], windowMs = 10 * 60_000): Upload[] {
  const sorted = [...versions].sort((a, b) => a.imported_at.localeCompare(b.imported_at))
  const out: Upload[] = []
  for (const v of sorted) {
    const last = out[out.length - 1]
    if (last && (last.source ?? '') === (v.source ?? '') && new Date(v.imported_at).getTime() - new Date(last.at).getTime() <= windowMs && !last.routes.some((r) => r.code === v.code)) {
      last.routes.push(v)
    } else out.push({ key: v.id, at: v.imported_at, source: v.source, by: v.imported_by, routes: [v] })
  }
  return out
}

const stopKey = (s: VersionStop) => s.code ?? s.box_id ?? '?'
// A jegyzékből időközben törölt box pillanatképében csak azonosító maradt — olvasható címke helyette
export const boxLabel = (k: string | null): string => (!k ? '?' : /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(k) ? 'törölt box' : k)
const minutes = (t: string | null): number | null => { if (!t) return null; const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? +m[1] * 60 + +m[2] : null }

export interface RouteDiff {
  code: string
  status: 'new' | 'removed' | 'changed' | 'same'
  count: number; prevCount: number
  added: { code: string; from: string | null }[]      // from: másik járatból jött
  removed: { code: string; to: string | null }[]      // to: másik járatba került
  reordered: number                                   // közös boxok, amelyek sorrendi helye változott
  etaShifts: { code: string; from: string | null; to: string | null; minutes: number }[]
  startFrom: string | null; startTo: string | null
}
export interface UploadDiff { routes: RouteDiff[]; totals: { boxes: number; prevBoxes: number; added: number; removed: number; moved: number; reordered: number; etaChanged: number } }

export function diffUploads(prev: Upload | null, cur: Upload): UploadDiff {
  const prevRoutes = new Map((prev?.routes ?? []).map((r) => [r.code, r]))
  const curRoutes = new Map(cur.routes.map((r) => [r.code, r]))
  const whereBefore = new Map<string, string>(), whereNow = new Map<string, string>()
  for (const r of prevRoutes.values()) for (const s of r.stops) whereBefore.set(stopKey(s), r.code)
  for (const r of curRoutes.values()) for (const s of r.stops) whereNow.set(stopKey(s), r.code)
  const codes = [...new Set([...prevRoutes.keys(), ...curRoutes.keys()])].sort()
  const routes: RouteDiff[] = codes.map((code) => {
    const p = prevRoutes.get(code), c = curRoutes.get(code)
    const pk = (p?.stops ?? []).map(stopKey), ck = (c?.stops ?? []).map(stopKey)
    const added = ck.filter((k) => !pk.includes(k)).map((k) => ({ code: k, from: whereBefore.get(k) ?? null }))
    const removed = pk.filter((k) => !ck.includes(k)).map((k) => ({ code: k, to: whereNow.get(k) ?? null }))
    const commonPrev = pk.filter((k) => ck.includes(k)), commonCur = ck.filter((k) => pk.includes(k))
    const reordered = commonPrev.filter((k, i) => commonCur[i] !== k).length
    const etaShifts: RouteDiff['etaShifts'] = []
    for (const s of c?.stops ?? []) {
      const ps = p?.stops.find((x) => stopKey(x) === stopKey(s))
      if (!ps) continue
      const a = minutes(ps.eta), b = minutes(s.eta)
      if (a != null && b != null && a !== b) etaShifts.push({ code: stopKey(s), from: ps.eta, to: s.eta, minutes: b - a })
    }
    const startFrom = p?.planned_start ?? null, startTo = c?.planned_start ?? null
    const status: RouteDiff['status'] = !p ? 'new' : !c ? 'removed' : (added.length || removed.length || reordered || etaShifts.length || (prev && startFrom !== startTo)) ? 'changed' : 'same'
    return { code, status, count: ck.length, prevCount: pk.length, added, removed, reordered, etaShifts, startFrom, startTo }
  })
  const moved = routes.reduce((n, r) => n + r.added.filter((a) => a.from).length, 0)
  return {
    routes,
    totals: {
      boxes: routes.reduce((n, r) => n + r.count, 0), prevBoxes: routes.reduce((n, r) => n + r.prevCount, 0),
      added: routes.reduce((n, r) => n + r.added.filter((a) => !a.from).length, 0),
      removed: routes.reduce((n, r) => n + r.removed.filter((x) => !x.to).length, 0),
      moved, reordered: routes.reduce((n, r) => n + r.reordered, 0), etaChanged: routes.reduce((n, r) => n + r.etaShifts.length, 0),
    },
  }
}

// "05:30:00" → "05:30"
export const hm = (t: string | null): string => (t ? t.slice(0, 5) : '—')
