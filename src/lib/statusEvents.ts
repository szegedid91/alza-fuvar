import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { submitNow } from './outbox'
import { getCurrentPosition, isOutsideGeofence } from './geo'
import { todayISO, localISODate } from './labels'
import { STATUS_META, type StatusKind } from './groupMessage'

// Jelzés rögzítése (idő, GPS, autó) — offline is sorba áll. A StatusCard
// (WhatsApp-jelzések) és az „Elindultam” gomb ugyanezt használja.
export async function recordStatusEvent(p: {
  workspaceId: string
  userId: string
  carId: string | null
  kind: StatusKind
  at: Date
  geofence?: { geo_lat: number | null; geo_lng: number | null; geo_radius_m: number | null } | null
}): Promise<string> {
  const gps = await getCurrentPosition(4000)
  const outside = p.geofence ? isOutsideGeofence(gps, p.geofence) : false
  const id = crypto.randomUUID()
  await submitNow({
    id, table: 'status_events', op: 'insert', label: `${STATUS_META[p.kind].title} – jelzés`,
    values: {
      id, workspace_id: p.workspaceId, user_id: p.userId, car_id: p.carId, work_date: localISODate(p.at), kind: p.kind, // LOG-38: a koppintás napja, nem a GPS-várakozás utáni
      at: p.at.toISOString(), gps_lat: gps.lat, gps_lng: gps.lng, outside_geofence: outside, note: null, confirmed_at: p.at.toISOString(),
    },
  })
  return id
}

export interface TodayStatusRow { kind: string; at: string }

// A saját mai jelzések (elindultam, megérkeztem, …) — EGY cache-kulcs minden
// felhasználónak (kezdőlap, AppShell, lépéssor), realtime/invalidate után frissül.
export function useTodayStatusEvents<T = TodayStatusRow[]>(select?: (rows: TodayStatusRow[]) => T) {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const date = todayISO()
  return useQuery({
    queryKey: ['status-events', currentWorkspaceId, profile?.id, date, 'home'],
    enabled: !!currentWorkspaceId && !!profile?.id,
    refetchInterval: 60000,
    queryFn: async (): Promise<TodayStatusRow[]> => {
      const { data, error } = await supabase.from('status_events').select('kind, at')
        .eq('workspace_id', currentWorkspaceId!).eq('user_id', profile!.id).eq('work_date', date).order('at')
      if (error) throw error
      return (data ?? []).map((r) => ({ kind: r.kind as string, at: r.at }))
    },
    select,
  })
}
