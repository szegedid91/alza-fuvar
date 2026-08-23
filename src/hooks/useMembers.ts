import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import type { Tables } from '../lib/database.types'

export type Member = Tables<'profiles'>

// Az aktuális munkaterület aktív tagjai (beosztáshoz, előleghez).
export function useMembers() {
  const { currentWorkspaceId } = useWorkspace()
  return useQuery({
    queryKey: ['ws-members', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('workspace_id', currentWorkspaceId!)
        .eq('status', 'active')
        .order('full_name')
      if (error) throw error
      return data as Member[]
    },
  })
}
