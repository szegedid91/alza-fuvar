import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { todayISO } from '../lib/labels'

export interface MyRouteShift { id: string; car_id: string; round: number; route_id: string; plate: string }

// A mai járatos beosztásaim kör szerint (1. kör, 2. kör) — a kezdőlap járat-kártyái és a nap-vége
// logika ugyanebből dolgozik, hogy a körök száma mindkét helyen ugyanaz legyen.
export function useMyRoutesToday() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const date = todayISO()
  return useQuery({
    queryKey: ['my-routes-today', currentWorkspaceId, profile?.id, date],
    enabled: !!currentWorkspaceId && !!profile?.id,
    refetchInterval: 60000,
    queryFn: async (): Promise<MyRouteShift[]> => {
      const uid = profile!.id
      const [{ data: shifts, error }, { data: cars, error: carErr }] = await Promise.all([
        supabase.from('shifts').select('id, car_id, round, route_id')
          .eq('workspace_id', currentWorkspaceId!).eq('work_date', date).not('route_id', 'is', null)
          .or(`driver_id.eq.${uid},loader_id.eq.${uid},trainee_id.eq.${uid}`).order('round'),
        supabase.from('cars').select('id, plate').eq('workspace_id', currentWorkspaceId!),
      ])
      if (error) throw error
      if (carErr) throw carErr
      const plates = new Map((cars ?? []).map((c) => [c.id, c.plate]))
      return (shifts ?? []).map((s) => ({ ...s, route_id: s.route_id!, round: s.round ?? 1, plate: plates.get(s.car_id) ?? '?' }))
    },
  })
}
