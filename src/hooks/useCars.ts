import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import type { Tables } from '../lib/database.types'

// A kategória (név + létszám) minden autó-listában elérhető — régi cache-ből
// jövő soroknál hiányozhat, ezért mindig ?.-tal olvasd.
export type Car = Tables<'cars'> & { category?: { name: string; crew_size: number } | null }

// Az aktuális munkaterület autói. Az activeOnly a cache-kulcs része,
// így az "összes autó" (admin lista) és a "csak aktív" (beosztás, fuvarterv)
// nézetek nem írják felül egymást a query-cache-ben.
export function useCars(activeOnly = false) {
  const { currentWorkspaceId } = useWorkspace()
  return useQuery({
    queryKey: ['cars', currentWorkspaceId, activeOnly],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      let q = supabase.from('cars').select('*, category:car_categories(name, crew_size)')
        .eq('workspace_id', currentWorkspaceId!).order('plate')
      if (activeOnly) q = q.eq('active', true)
      const { data, error } = await q
      if (error) throw error
      return data as unknown as Car[]
    },
  })
}
