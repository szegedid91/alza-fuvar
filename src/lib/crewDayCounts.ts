// Fejenkénti napszám a beosztásból (hét / hónap): összes, Box-os, XL-es és betanuló napok.
// Egy nap a Box-ba és az XL-be is beleszámít, ha az ember aznap mindkét típusú autón volt;
// az „összes” a különböző napok száma. Betanuló: amikor betanulóként volt beosztva.
export interface CrewShiftLike { work_date: string; car_id: string; driver_id: string | null; loader_id: string | null; trainee_id: string | null }
export interface CrewMemberLike { id: string; role: string | null; full_name: string | null; email: string | null }
export interface CrewDayCount { id: string; name: string; count: number; box: number; xl: number; trainee: number }

export function crewDayCounts(shifts: CrewShiftLike[], members: CrewMemberLike[], isBoxCar: (carId: string) => boolean): CrewDayCount[] {
  const byUser = new Map<string, { all: Set<string>; box: Set<string>; xl: Set<string>; trainee: Set<string> }>()
  for (const s of shifts) {
    for (const uid of [s.driver_id, s.loader_id, s.trainee_id]) {
      if (!uid) continue
      if (!byUser.has(uid)) byUser.set(uid, { all: new Set(), box: new Set(), xl: new Set(), trainee: new Set() })
      const u = byUser.get(uid)!
      u.all.add(s.work_date)
      ;(isBoxCar(s.car_id) ? u.box : u.xl).add(s.work_date)
      if (uid === s.trainee_id) u.trainee.add(s.work_date)
    }
  }
  // Minden nem-admin/nem-menedzser tag felsorolva (0 nappal is); vezető csak ha be van osztva
  return members
    .filter((m) => (m.role !== 'admin' && m.role !== 'manager') || (byUser.get(m.id)?.all.size ?? 0) > 0)
    .map((m) => {
      const u = byUser.get(m.id)
      return { id: m.id, name: m.full_name || m.email || '—', count: u?.all.size ?? 0, box: u?.box.size ?? 0, xl: u?.xl.size ?? 0, trainee: u?.trainee.size ?? 0 }
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}
