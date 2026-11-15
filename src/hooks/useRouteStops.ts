import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import type { Tables } from '../lib/database.types'
import type { AlzaBox } from '../lib/boxSheet'

export type RouteStop = Tables<'route_stops'> & { box: AlzaBox }

// Járatonként a hozzárendelt AlzaBoxok sorrendben (a vezető állítja össze a
// Beosztás oldalon; a futár a kezdőlapi járat-kártyán ebből navigál).
// onlyRouteIds: a FUTÁR csak a saját mai járatait tölti le (1–2 járat, ~15–30 kB) — nem az egész munkaterület
// összes járatát a teljes box-adattal (~250–300 kB). `undefined` = minden járat (vezetői oldalak);
// `null` = még nem tudjuk (a beosztás töltődik): addig nem kérdezünk; üres lista = nincs mit letölteni.
export function useRouteStops(onlyRouteIds?: string[] | null) {
  const { currentWorkspaceId } = useWorkspace()
  const scoped = onlyRouteIds !== undefined
  const ids = scoped && onlyRouteIds ? [...new Set(onlyRouteIds)].sort() : null
  return useQuery({
    queryKey: scoped ? ['route-stops', currentWorkspaceId, 'v2', 'mine', ids?.join(',') ?? ''] : ['route-stops', currentWorkspaceId, 'v2'],
    // ritkán változik; a módosítás (mentés, élő frissítés) érvényteleníti — visszaváltáskor nem töltjük le újra
    staleTime: 10 * 60_000,
    enabled: !!currentWorkspaceId && (!scoped || ids !== null),
    queryFn: async () => {
      const byRoute: Record<string, RouteStop[]> = {}
      if (scoped && (!ids || ids.length === 0)) return byRoute
      let q = supabase.from('route_stops').select('*, box:alza_boxes(*)')
        .eq('workspace_id', currentWorkspaceId!)
      if (ids) q = q.in('route_id', ids)
      const { data, error } = await q.order('sort_order').order('created_at')
      if (error) throw error
      // Sima objektum (nem Map): a perzisztált query-cache JSON-ként menti, Map-ből üres objektum lenne
      for (const row of (data ?? []) as unknown as RouteStop[]) {
        if (!row.box) continue
        ;(byRoute[row.route_id] ??= []).push(row)
      }
      return byRoute
    },
  })
}
