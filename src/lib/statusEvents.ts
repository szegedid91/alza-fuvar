import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { submitNow } from './outbox'
import { getCurrentPosition, isOutsideGeofence } from './geo'
import { STATUS_META, type StatusKind } from './groupMessage'
import { workDayISO } from './workDay'
import { useWorkDay } from '../hooks/useWorkDay'

// Jelzés rögzítése (idő, GPS, autó) — offline is sorba áll. A StatusCard
// (WhatsApp-jelzések) és az „Elindultam” gomb ugyanezt használja.
//
// A jelzés AZONNAL a telefon helyi sorába kerül (koordináta nélkül), nem a GPS-re várva: a koppintás után a
// WhatsApp kerül előtérbe, és ha a telefon közben bezárja az appot, a jelzés akkor is megvan. A GPS a háttérben
// érkezik (legfeljebb 8 mp), és utólag kerül rá a sorra — a geofence-jelzéssel együtt.
// id: a hívó előre megadhatja (az elszámolás felvételei így már a jelzés mentése ELŐTT a sorba tehetők).
export async function recordStatusEvent(p: {
  workspaceId: string
  userId: string
  carId: string | null
  kind: StatusKind
  at: Date
  geofence?: { geo_lat: number | null; geo_lng: number | null; geo_radius_m: number | null } | null
  id?: string
}): Promise<string> {
  const id = p.id ?? crypto.randomUUID()
  const gpsLater = getCurrentPosition(8000) // a koppintás pillanatában indul, de nem várunk rá
  await submitNow({
    id, table: 'status_events', op: 'insert', label: `${STATUS_META[p.kind].title} – jelzés`,
    values: {
      id, workspace_id: p.workspaceId, user_id: p.userId, car_id: p.carId, work_date: workDayISO(p.at), kind: p.kind, // LOG-38: a koppintás pillanatának MUNKANAPJA (este 18:00-tól a holnapi; nyitott becsekkolásnál annak a napja)
      at: p.at.toISOString(), gps_lat: null, gps_lng: null, outside_geofence: false, note: null, confirmed_at: p.at.toISOString(),
    },
  })
  // a hely utólag: ha megjön, a sorra írjuk (a helyi soron át — térerő nélkül is felmegy később)
  void gpsLater.then((gps) => {
    if (gps.lat == null || gps.lng == null) return
    const outside = p.geofence ? isOutsideGeofence(gps, p.geofence) : false
    return submitNow({
      id: crypto.randomUUID(), table: 'status_events', op: 'update', match: { id }, label: `${STATUS_META[p.kind].title} – hely`,
      values: { gps_lat: gps.lat, gps_lng: gps.lng, outside_geofence: outside },
    })
  }).catch((e) => { console.warn('jelzés helye', e) })
  return id
}

export interface TodayStatusRow { kind: string; at: string }

// A saját mai jelzések (elindultam, megérkeztem, …) — EGY cache-kulcs minden
// felhasználónak (kezdőlap, AppShell, lépéssor), realtime/invalidate után frissül.
export function useTodayStatusEvents<T = TodayStatusRow[]>(select?: (rows: TodayStatusRow[]) => T) {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const date = useWorkDay()
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
