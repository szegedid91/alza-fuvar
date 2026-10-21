import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useToday } from './useToday'
import { checkInspectionRequirement, type InspectionReason } from '../lib/checkin'

export interface InspectionGateState {
  loading: boolean
  blocked: boolean
  waived: boolean
  waivedAt: string | null
  error: boolean // az állapot nem volt ellenőrizhető (pl. offline)
  retry: () => void
  reasons: InspectionReason[] // 9-e / sofőrváltás — csak tájékoztatás, a fotó mindig kötelező
  lastDriverName?: string | null
  checkinId: string | null
  helpRequestedAt: string | null
}

// A becsekkolás csak a körbefotózással teljes: amíg MA nincs ellenőrző
// fotósor az autón, a tankolás / takarítás / Box-lap / nap lezárása zárva.
// Kivétel: a vezető a saját fiókjából fotó nélkül továbbengedte (check_ins.inspection_waived_at).
export function useInspectionGate(carId: string | undefined, date: string): InspectionGateState {
  const { profile } = useAuth()
  const todayQ = useToday()
  const reasonsQ = useQuery({
    queryKey: ['inspection-reasons', carId, date, profile?.id],
    enabled: !!carId && !!profile,
    queryFn: () => checkInspectionRequirement(carId!, profile!.id, date),
  })
  const t = todayQ.data
  const waived = !!t?.checkin?.inspection_waived_at
  const blocked = !!t?.car && !t.inspectionDone && !waived
  // Amíg a kapu zárva (a munkatárs a vezetői engedélyre vár), 15 mp-enként
  // frissítünk — az engedély után magától kinyílik, nem kell újratölteni.
  const qc = useQueryClient()
  useEffect(() => {
    if (!blocked) return
    const id = setInterval(() => { void qc.invalidateQueries({ queryKey: ['today'] }) }, 15000)
    return () => clearInterval(id)
  }, [blocked, qc])
  return {
    loading: todayQ.isLoading,
    // Hibánál NEM nyitunk kaput (a fotó nem kerülhető meg azzal, hogy nincs térerő)
    blocked,
    waived,
    waivedAt: t?.checkin?.inspection_waived_at ?? null,
    error: todayQ.isError,
    retry: () => { void todayQ.refetch() },
    reasons: reasonsQ.data?.required ? reasonsQ.data.reasons : [],
    lastDriverName: reasonsQ.data?.lastDriverName,
    checkinId: t?.checkin?.id ?? null,
    helpRequestedAt: t?.checkin?.inspection_help_requested_at ?? null,
  }
}
