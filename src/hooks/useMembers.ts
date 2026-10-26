import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import type { Tables } from '../lib/database.types'

export type Member = Tables<'profiles'>

// Az aktuális munkaterület aktív tagjai (beosztáshoz, előleghez) — az előre
// felvett (meghívott, még nem regisztrált) munkatársakkal együtt, hogy a
// beosztás előre tervezhető legyen.
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
        .in('status', ['active', 'invited'])
        .order('full_name')
      if (error) throw error
      return data as Member[]
    },
  })
}
