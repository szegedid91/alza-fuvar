import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import type { Tables } from '../lib/database.types'
import type { AlzaBox } from '../lib/boxSheet'

export type RouteStop = Tables<'route_stops'> & { box: AlzaBox }

// Járatonként a hozzárendelt AlzaBoxok sorrendben (a vezető állítja össze a
// Beosztás oldalon; a futár a kezdőlapi járat-kártyán ebből navigál)
export function useRouteStops() {
  const { currentWorkspaceId } = useWorkspace()
  return useQuery({
    queryKey: ['route-stops', currentWorkspaceId, 'v2'],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('route_stops').select('*, box:alza_boxes(*)')
        .eq('workspace_id', currentWorkspaceId!).order('sort_order').order('created_at')
      if (error) throw error
      // Sima objektum (nem Map): a perzisztált query-cache JSON-ként menti, Map-ből üres objektum lenne
      const byRoute: Record<string, RouteStop[]> = {}
      for (const row of (data ?? []) as unknown as RouteStop[]) {
        if (!row.box) continue
        ;(byRoute[row.route_id] ??= []).push(row)
      }
      return byRoute
    },
  })
}
