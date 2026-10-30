import type { Tables } from './database.types'

// Napi Box-lap (AlzaBox szállítási lap) — a papírlap oszlopai és segédfüggvényei.
export type BoxSheet = Tables<'box_sheets'>
export type BoxStop = Tables<'box_sheet_stops'>
export type AlzaBox = Tables<'alza_boxes'>

export type StopNumKey = 'placed' | 'missorted' | 'nf' | 'oversize' | 'shortage' | 'returned' | 'damaged' | 'left_on_car'

// A papírlap megálló-oszlopai: rövid (jelvény / táblázat-fejléc) és hosszú (űrlap) címke
export const STOP_FIELDS: { key: StopNumKey; short: string; label: string }[] = [
  { key: 'placed', short: 'Behelyezve', label: 'Boxba behelyezett csomag (db)' },
  { key: 'missorted', short: 'Rossz szort.', label: 'Rosszul szortírozott áru (db, raktári)' },
  { key: 'nf', short: 'NF', label: 'NF – Nincs szabad fiók (db)' },
  { key: 'oversize', short: 'Túlméretes', label: 'Túlméretes (db)' },
  { key: 'shortage', short: 'Hiány', label: 'Hiány – box képernyő (db)' },
  { key: 'returned', short: 'Visszáru', label: 'Visszáru a boxból (db)' },
  { key: 'damaged', short: 'ÉK/NHB/törölt', label: 'ÉK (Érvénytelen kód a kijelzőn) / NHB (Ne helyezd be – kijelző) / törölt (db)' },
  { key: 'left_on_car', short: 'Autón maradt', label: 'Autón maradt (db)' },
]

export type CompKey = 'comp_bu' | 'comp_szh' | 'comp_hb' | 'comp_r'
export const COMP_FIELDS: { key: CompKey; short: string; label: string }[] = [
  { key: 'comp_bu', short: 'BU', label: 'Box újraindítás (BU)' },
  { key: 'comp_szh', short: 'SZH', label: 'Szkenner hiba (SZH)' },
  { key: 'comp_hb', short: 'HB', label: 'Nem tölthető box (HB, db)' },
  { key: 'comp_r', short: 'R', label: 'Redphonra bejelentve (R)' },
]

export type RetKey = 'ret_c' | 'ret_d' | 'ret_m' | 'ret_e'
export const RET_FIELDS: { key: RetKey; label: string }[] = [
  { key: 'ret_c', label: 'C' }, { key: 'ret_d', label: 'D' }, { key: 'ret_m', label: 'M' }, { key: 'ret_e', label: 'E' },
]

export type WhKey = 'wh_crates_no_label' | 'wh_packages_no_label' | 'wh_pallet_items'
export const WH_FIELDS: { key: WhKey; label: string }[] = [
  { key: 'wh_crates_no_label', label: 'Láda címke nélkül (db)' },
  { key: 'wh_packages_no_label', label: '…ebben csomag (db)' },
  { key: 'wh_pallet_items', label: 'Raklapos: címke nélkül / duplacímke / nem behelyezhető (db)' },
]

export function stopTotals(stops: Pick<BoxStop, StopNumKey>[]): Record<StopNumKey, number> {
  const t = Object.fromEntries(STOP_FIELDS.map((f) => [f.key, 0])) as Record<StopNumKey, number>
  for (const s of stops) for (const f of STOP_FIELDS) t[f.key] += Number(s[f.key] ?? 0)
  return t
}

// "05:40:00" (DB time) → "05:40"
export function hhmm(t: string | null | undefined): string {
  if (!t) return '–'
  return t.slice(0, 5)
}

export function hhmmOfISO(iso: string | null | undefined): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
}

// Google Maps útvonaltervezés az adott koordinátára (az app-ból egy koppintás)
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
}

// Ékezet- és kisbetű-független keresés
export function normalize(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function isBoxCode(q: string): boolean {
  return /^[a-z]{1,3}\d{2,6}$/i.test(q.trim())
}

// Keresés kód / név / cím szerint: a kód-egyezés előre kerül
export function searchBoxes(boxes: AlzaBox[], query: string, limit = 20): AlzaBox[] {
  const q = normalize(query).trim()
  if (!q) return []
  const words = q.split(/\s+/).filter(Boolean)
  const scored: { b: AlzaBox; s: number }[] = []
  for (const b of boxes) {
    const code = normalize(b.code)
    const name = normalize(b.name)
    const addr = normalize(b.address)
    let s = 0
    if (code && code === q) s = 100
    else if (code && code.startsWith(q)) s = 80
    else if (words.every((w) => name.includes(w))) s = 60
    else if (words.every((w) => name.includes(w) || addr.includes(w))) s = 40
    else if (code && code.includes(q)) s = 30
    if (s > 0) scored.push({ b, s })
  }
  scored.sort((a, b) => b.s - a.s || a.b.name.localeCompare(b.b.name, 'hu'))
  return scored.slice(0, limit).map((x) => x.b)
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString('hu-HU', { maximumFractionDigits: 1 })} km`
}
