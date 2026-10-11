// Naptár- és beosztás-segédek (tiszta függvények, UI nélkül) — a
// beosztás-szerkesztő három komponense és a tesztek közösen használják.
// MINDEN dátum helyi (Budapest) naptári nap, 'YYYY-MM-DD' formában — soha
// nem toISOString().slice(0,10) (az az UTC-napot adná).
import type { Tables } from './database.types'

type Car = Tables<'cars'>

// ---- Naptár segédek (hétfő-kezdéssel) ----
export function pad2(n: number): string { return String(n).padStart(2, '0') }

export function monthGrid(ym: string): (string | null)[] {
  const [y, m] = ym.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7 // hétfő = 0
  const cells: (string | null)[] = Array.from({ length: firstDow }, () => null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${ym}-${pad2(d)}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

export function addDays(dateISO: string, n: number): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
}

export function mondayOf(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return addDays(dateISO, -((dt.getDay() + 6) % 7))
}

// Az autó kategóriája szerinti létszám (1 = csak sofőr, 2 = sofőr + rakodó); alap 2
export function crewSizeFor(cars: Car[] | undefined, categories: { id: string; crew_size: number }[] | undefined, carId: string): 1 | 2 {
  const car = (cars ?? []).find((c) => c.id === carId)
  const cat = (categories ?? []).find((k) => k.id === car?.category_id)
  return cat?.crew_size === 1 ? 1 : 2
}

export const DAY_NAMES_LONG = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap']

// Timestamp → helyi naptári nap (a .slice(0,10) az UTC-napot adná,
// így a hajnali események a szomszéd napon jelennének meg)
export function localDateOf(ts: string): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export const MONTH_NAMES = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december']

export function monthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${y}. ${MONTH_NAMES[m - 1]}`
}

// Rövid név a naptár-chipekhez (a név utolsó tagja)
export function shortName(full: string | null | undefined): string {
  if (!full) return '—'
  const parts = full.trim().split(/\s+/)
  return parts[parts.length - 1].slice(0, 7)
}

// Autó-lista kategóriánként csoportosítva, a kategóriák beállított sorrendjében.
// A kategória nélküli autók a végén, "Egyéb" néven.
export function groupByCategory<T extends { id: string; category_id: string | null }>(
  list: T[],
  categories: { id: string; name: string }[] | undefined,
): { name: string; cars: T[] }[] {
  const groups: { name: string; cars: T[] }[] = []
  for (const cat of categories ?? []) {
    const inCat = list.filter((c) => c.category_id === cat.id)
    if (inCat.length > 0) groups.push({ name: cat.name, cars: inCat })
  }
  const rest = list.filter((c) => !c.category_id || !(categories ?? []).some((k) => k.id === c.category_id))
  if (rest.length > 0) groups.push({ name: 'Egyéb', cars: rest })
  return groups
}

// Heti címke a táblázat fejlécébe — telefonon is egy sor:
// "2026. október 5–11." / hónaphatáron "2026. szeptember 29. – október 5."
export function weekLabel(startISO: string, endISO: string): string {
  const [y1, m1, d1] = startISO.split('-').map(Number)
  const [y2, m2, d2] = endISO.split('-').map(Number)
  if (y1 === y2 && m1 === m2) return `${y1}. ${MONTH_NAMES[m1 - 1]} ${d1}–${d2}.`
  if (y1 === y2) return `${y1}. ${MONTH_NAMES[m1 - 1]} ${d1}. – ${MONTH_NAMES[m2 - 1]} ${d2}.`
  return `${y1}. ${MONTH_NAMES[m1 - 1]} ${d1}. – ${y2}. ${MONTH_NAMES[m2 - 1]} ${d2}.`
}
