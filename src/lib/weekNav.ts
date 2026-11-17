// Billentyűs lépkedés a heti beosztás-táblában (mint egy táblázatkezelőben):
// Tab = a következő nap ugyanazon mezője, Shift+Tab = az előző napé, Enter = az alatta lévő név.
// A mezők a táblában látható sorrendben jönnek (autónként, azon belül naponként, körönként, mezőnként).
export interface NavSlot { key: string; car: string; day: number; round: number; field: string }
export type NavDir = 'next' | 'prev' | 'down'

export const navKey = (car: string, day: number, round: number, field: string): string => `${car}|${day}|${round}|${field}`

// Ugyanabban a cellában a legjobban illő mező: ugyanaz a kör és mező, különben ugyanaz a mező az 1. körben,
// különben a cella első mezője (pl. Box napon nincs rakodó mező)
function inCell(slots: NavSlot[], car: string, day: number, like: NavSlot): NavSlot | null {
  const cell = slots.filter((s) => s.car === car && s.day === day)
  return cell.find((s) => s.round === like.round && s.field === like.field)
    ?? cell.find((s) => s.field === like.field)
    ?? cell[0] ?? null
}

export function navTarget(slots: NavSlot[], currentKey: string, dir: NavDir, days = 7): string | null {
  const cur = slots.find((s) => s.key === currentKey)
  if (!cur) return null
  if (dir === 'down') {
    // ugyanannak a napnak az oszlopában a következő mező lefelé (a cellán belül, majd a következő autónál)
    const col = slots.filter((s) => s.day === cur.day)
    return col[col.findIndex((s) => s.key === cur.key) + 1]?.key ?? null
  }
  const cars = [...new Set(slots.map((s) => s.car))]
  const step = dir === 'next' ? 1 : -1
  let ci = cars.indexOf(cur.car)
  let day = cur.day + step
  // a sor végén a következő autó hétfője, az elején az előző autó vasárnapja; az üres (zárolt) cellákat átlépi
  for (let guard = 0; guard < cars.length * days; guard++) {
    if (day >= days) { day = 0; ci++ } else if (day < 0) { day = days - 1; ci-- }
    if (ci < 0 || ci >= cars.length) return null
    const hit = inCell(slots, cars[ci], day, cur)
    if (hit) return hit.key
    day += step
  }
  return null
}
