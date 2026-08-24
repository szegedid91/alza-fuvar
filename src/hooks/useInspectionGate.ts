import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { checkInspectionRequirement, type InspectionReason } from '../lib/checkin'

export interface InspectionGateState {
  loading: boolean
  blocked: boolean
  error: boolean // a követelmény nem volt ellenőrizhető (pl. offline)
  retry: () => void
  reasons: InspectionReason[]
  lastDriverName?: string | null
}

// Kötelező ellenőrzés kikényszerítése: ha ma kell (9-e / sofőrváltás) és még nincs kész,
// a fuvar/tankolás blokkolt.
export function useInspectionGate(carId: string | undefined, date: string): InspectionGateState {
  const { profile } = useAuth()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['inspection-gate', carId, date, profile?.id],
    enabled: !!carId && !!profile,
    queryFn: async () => {
      const req = await checkInspectionRequirement(carId!, profile!.id, date)
      if (!req.required) return { blocked: false, reasons: [], lastDriverName: req.lastDriverName }
      const { count } = await supabase
        .from('car_inspections')
        .select('id', { count: 'exact', head: true })
        .eq('car_id', carId!)
        .eq('work_date', date)
      return { blocked: (count ?? 0) === 0, reasons: req.reasons, lastDriverName: req.lastDriverName }
    },
  })
  return {
    loading: isLoading,
    // Hibánál NEM nyitunk kaput (a kötelező ellenőrzés nem kerülhető meg
    // azzal, hogy nincs térerő) — a komponens hibakártyát mutat helyette.
    blocked: data?.blocked ?? false,
    error: isError,
    retry: () => { void refetch() },
    reasons: data?.reasons ?? [],
    lastDriverName: data?.lastDriverName,
  }
}
