import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import type { Tables } from '../lib/database.types'

export type RouteName = Tables<'route_names'>

// Névvel ellátott körök (R, G, I…) — a beosztásban körönként választható
export function useRoutes() {
  const { currentWorkspaceId } = useWorkspace()
  return useQuery({
    queryKey: ['route-names', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('route_names').select('*')
        .eq('workspace_id', currentWorkspaceId!).order('sort_order').order('code')
      if (error) throw error
      return (data ?? []) as RouteName[]
    },
  })
}
