import { submitNow } from './outbox'
import { getCurrentPosition, isOutsideGeofence } from './geo'
import { todayISO } from './labels'
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
      id, workspace_id: p.workspaceId, user_id: p.userId, car_id: p.carId, work_date: todayISO(), kind: p.kind,
      at: p.at.toISOString(), gps_lat: gps.lat, gps_lng: gps.lng, outside_geofence: outside, note: null, confirmed_at: p.at.toISOString(),
    },
  })
  return id
}
