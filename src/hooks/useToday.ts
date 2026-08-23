import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { todayISO } from '../lib/labels'
import { getCrewForDay, type Car, type CrewMember } from '../lib/checkin'
import type { Tables } from '../lib/database.types'

export interface TodayState {
  date: string
  checkin: Tables<'check_ins'> | null
  car: Car | null
  crew: CrewMember[]
  // A mai beosztott szerep a beosztásból (nem a profilból) — a menedzser dönti el.
  assignedRole: 'driver' | 'loader' | null
}

// Az aktuális felhasználó mai becsekkolása az aktuális munkaterületen.
export function useToday() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const date = todayISO()

  return useQuery<TodayState>({
    queryKey: ['today', currentWorkspaceId, profile?.id, date],
    enabled: !!currentWorkspaceId && !!profile?.id,
    queryFn: async () => {
      // A két lekérdezés független — párhuzamosan futnak.
      // FONTOS: limit(1) nélkül a maybeSingle() több sor esetén (pl. napközbeni
      // autóváltás = két becsekkolás) hibát ad és "nincs becsekkolva"-t mutatna.
      const [{ data: ci }, { data: shift }] = await Promise.all([
        supabase
          .from('check_ins')
          .select('*, car:cars(*)')
          .eq('workspace_id', currentWorkspaceId!)
          .eq('user_id', profile!.id)
          .eq('work_date', date)
          .order('checked_in_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('shifts')
          .select('driver_id, loader_id')
          .eq('workspace_id', currentWorkspaceId!)
          .eq('work_date', date)
          .or(`driver_id.eq.${profile!.id},loader_id.eq.${profile!.id}`)
          .limit(1)
          .maybeSingle(),
      ])

      const row = ci as unknown as (Tables<'check_ins'> & { car: Car | null }) | null
      const checkin = row ? ({ ...row, car: undefined } as unknown as Tables<'check_ins'>) : null
      const car = row?.car ?? null
      const crew = car ? await getCrewForDay(car.id, date) : []

      // Mai beosztott szerep a shiftből
      const assignedRole: 'driver' | 'loader' | null =
        shift?.driver_id === profile!.id ? 'driver' : shift?.loader_id === profile!.id ? 'loader' : null

      return { date, checkin, car, crew, assignedRole }
    },
  })
}
