import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { distanceMeters } from '../lib/geo'
import { useToday } from './useToday'

// Ennyi méteres kör elhagyása után szólunk a hiányzó autó-ellenőrzésért
const ZONE_M = 20

// A becsekkolás körüli 20 m-es kör elhagyásának figyelése.
// Ha aznap NINCS ellenőrzés az autóra, a szervernek jelezzük — onnantól a
// szerver küldi az értesítést (azonnal, majd 5 percenként, amíg el nem készül),
// így akkor is megy, ha az app közben bezárul.
// Az emlékeztető az AUTÓRA szól: párban mindketten kapják, és ha bármelyikük
// feltölti, a DB lezárja — utána egyikük sem kap többet.
export function useInspectionZone(): void {
  const { profile } = useAuth()
  const { data: today } = useToday()
  const reportedRef = useRef<string | null>(null)

  const carId = today?.car?.id ?? null
  const workDate = today?.date ?? null
  const checkedOut = !!today?.checkin?.checked_out_at
  const originLat = today?.checkin?.gps_lat ?? null
  const originLng = today?.checkin?.gps_lng ?? null

  // Van-e már ma ellenőrzés erre az autóra (bármelyik társtól)?
  const { data: hasInspection } = useQuery({
    queryKey: ['zone-inspection', carId, workDate],
    enabled: !!carId && !!workDate && !checkedOut,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('car_inspections')
        .select('id', { count: 'exact', head: true })
        .eq('car_id', carId!)
        .eq('work_date', workDate!)
      if (error) throw error
      return (count ?? 0) > 0
    },
  })

  // Fut-e már nyitott emlékeztető erre az autóra/napra? (a társ is elindíthatta)
  const { data: reminderOpen } = useQuery({
    queryKey: ['zone-reminder', carId, workDate],
    enabled: !!carId && !!workDate && !checkedOut && hasInspection === false,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspection_reminders')
        .select('id, resolved_at')
        .eq('car_id', carId!)
        .eq('work_date', workDate!)
        .maybeSingle()
      if (error) throw error
      return !!data && !data.resolved_at
    },
  })

  useEffect(() => {
    if (!profile || !carId || !workDate) return
    if (checkedOut) return
    if (hasInspection !== false) return // már van ellenőrzés (vagy még töltődik)
    if (reminderOpen !== false) return // a szerver már küldi (vagy még töltődik)
    if (originLat == null || originLng == null) return // nincs becsekkolási pozíció
    if (reportedRef.current === `${carId}|${workDate}`) return
    if (!('geolocation' in navigator)) return

    let stopped = false
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (stopped) return
        const dist = distanceMeters(originLat, originLng, pos.coords.latitude, pos.coords.longitude)
        const acc = pos.coords.accuracy ?? 0
        // A pontatlan fixek ne indítsanak hamis riasztást: a mért távolság
        // legyen nagyobb a körnél ÉS a mérés hibahatáránál is
        if (dist <= ZONE_M || dist <= acc) return

        stopped = true
        navigator.geolocation.clearWatch(watchId)
        reportedRef.current = `${carId}|${workDate}`
        void supabase.from('inspection_reminders').insert({
          workspace_id: today!.checkin!.workspace_id,
          car_id: carId,
          work_date: workDate,
          left_zone_by: profile.id,
        }).then(({ error }) => {
          // Ütközés = a társ már jelezte; minden más hibánál újra próbálkozhat
          if (error && !error.message.includes('duplicate')) reportedRef.current = null
        })
      },
      () => { /* GPS megtagadva/hiba: nem blokkoló */ },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    )
    return () => { stopped = true; navigator.geolocation.clearWatch(watchId) }
  }, [profile, carId, workDate, checkedOut, hasInspection, reminderOpen, originLat, originLng, today])
}
