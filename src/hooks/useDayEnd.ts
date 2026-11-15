import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { getFuelSkip, setFuelSkip, subscribeFuelSkip } from '../lib/dayEnd'

// Volt-e ma takarítás ezen az autón (bárkitől), mikor, és hány fotóval
export function useCleaningToday(carId: string | null | undefined, date: string) {
  return useQuery({
    // a „cleaning” + autó előtag miatt a takarítás-kártya mentése ezt is frissíti
    queryKey: ['cleaning', carId, date, 'summary'],
    enabled: !!carId && !!date,
    queryFn: async () => {
      const { data, error } = await supabase.from('cleanings').select('created_at, photos:cleaning_photos(id)')
        .eq('car_id', carId!).eq('work_date', date).order('created_at')
      if (error) throw error
      const rows = (data ?? []) as unknown as { created_at: string; photos: { id: string }[] | null }[]
      return { done: rows.length > 0, at: rows[0]?.created_at ?? null, photos: rows.reduce((a, r) => a + (r.photos?.length ?? 0), 0) }
    },
  })
}

// Volt-e ma tankolás (blokkal) ezen az autón
export function useFuelToday(carId: string | null | undefined, date: string, enabled = true) {
  return useQuery({
    queryKey: ['fuel-today', carId, date],
    enabled: enabled && !!carId && !!date,
    queryFn: async () => {
      const { data, error } = await supabase.from('fuel_logs').select('created_at, liters')
        .eq('car_id', carId!).eq('work_date', date).order('created_at')
      if (error) throw error
      const rows = data ?? []
      return { done: rows.length > 0, at: rows.length ? rows[rows.length - 1].created_at : null, liters: rows.reduce((a, r) => a + Number(r.liters ?? 0), 0) }
    },
  })
}

// Dízel / benzines autónál a nap végén: tankolás (blokk fotóval) az „Autó lerakva” előtt.
// ok: mehet az autó lerakása (megvolt a tankolás, vagy a futár jelezte, hogy ma nem tankolt; elektromosnál mindig).
export function useFuelGate(car: { id: string; fuel_type: string } | null | undefined, date: string) {
  const needed = !!car && car.fuel_type !== 'electric'
  const { data: fuel, isLoading } = useFuelToday(car?.id, date, needed)
  const skipped = useSyncExternalStore(subscribeFuelSkip, () => getFuelSkip(car?.id, date), () => false)
  const done = !!fuel?.done
  return {
    needed, done, skipped, isLoading: needed && isLoading, fuel: fuel ?? null,
    ok: !needed || done || skipped,
    setSkipped: (on: boolean) => { if (car) setFuelSkip(car.id, date, on) },
  }
}
