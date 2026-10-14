import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { resolveNames } from './names'
import { todayISO } from './labels'

// "Túl sokan egy autón": egy autón ma több NYITOTT becsekkolás van, mint a
// kategória létszáma (Box = 1 fő, XL = 2 fő). Ez mindig vezetői beavatkozást
// kér — vagy téves becsekkolás, vagy valaki elfelejtett átváltani/kijelentkezni.
export interface ConflictPerson {
  checkinId: string
  userId: string
  name: string
  checkedInAt: string
  // Ő volt az, aki a figyelmeztetés ellenére csekkolt be
  flagged: boolean
}

export interface CrewConflict {
  carId: string
  plate: string
  category: string | null
  capacity: number
  people: ConflictPerson[]
}

export async function findCrewConflicts(workspaceId: string, date: string): Promise<CrewConflict[]> {
  const [{ data: cars, error: carErr }, { data: cis, error: ciErr }] = await Promise.all([
    supabase.from('cars').select('id, plate, category:car_categories(name, crew_size)').eq('workspace_id', workspaceId),
    supabase.from('check_ins').select('id, car_id, user_id, checked_in_at, crew_conflict')
      .eq('workspace_id', workspaceId).eq('work_date', date).is('checked_out_at', null).order('checked_in_at'),
  ])
  if (carErr) throw carErr
  if (ciErr) throw ciErr

  const carMap = new Map((cars ?? []).map((c) => [c.id, c as unknown as { id: string; plate: string; category: { name: string; crew_size: number } | null }]))
  const byCar = new Map<string, NonNullable<typeof cis>>()
  for (const ci of cis ?? []) {
    if (!byCar.has(ci.car_id)) byCar.set(ci.car_id, [])
    byCar.get(ci.car_id)!.push(ci)
  }

  const conflicts: CrewConflict[] = []
  for (const [carId, rows] of byCar) {
    const car = carMap.get(carId)
    const capacity = car?.category?.crew_size === 1 ? 1 : 2
    if (rows.length <= capacity) continue
    conflicts.push({
      carId, plate: car?.plate ?? '?', category: car?.category?.name ?? null, capacity,
      people: rows.map((r) => ({ checkinId: r.id, userId: r.user_id, name: '', checkedInAt: r.checked_in_at, flagged: r.crew_conflict })),
    })
  }
  if (conflicts.length === 0) return []

  const names = await resolveNames(conflicts.flatMap((c) => c.people.map((p) => p.userId)))
  for (const c of conflicts) for (const p of c.people) p.name = names[p.userId] ?? 'Ismeretlen'
  return conflicts.sort((a, b) => a.plate.localeCompare(b.plate))
}

// Vezetői nézetekhez (Áttekintés, kezdőlap-banner) — percenként frissül,
// a realtime invalidálás ['crew-conflicts'] kulccsal gyorsítja.
export function useCrewConflicts(enabled = true) {
  const { currentWorkspaceId } = useWorkspace()
  const date = todayISO()
  return useQuery({
    queryKey: ['crew-conflicts', currentWorkspaceId, date],
    enabled: enabled && !!currentWorkspaceId,
    refetchInterval: 60000,
    queryFn: () => findCrewConflicts(currentWorkspaceId!, date),
  })
}
