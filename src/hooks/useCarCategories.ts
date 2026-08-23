import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import type { Tables } from '../lib/database.types'

export type CarCategory = Tables<'car_categories'>

// Autó-kategóriák a munkaterületen, a beállított sorrendben
export function useCarCategories() {
  const { currentWorkspaceId } = useWorkspace()
  return useQuery({
    queryKey: ['car-categories', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('car_categories').select('*')
        .eq('workspace_id', currentWorkspaceId!)
        .order('sort_order').order('name')
      if (error) throw error
      return data as CarCategory[]
    },
  })
}
