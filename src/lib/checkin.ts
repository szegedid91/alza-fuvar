import { supabase } from './supabase'
import { resolveNames } from './names'
import type { Enums, Tables } from './database.types'

export type Car = Tables<'cars'>

export interface CrewMember {
  user_id: string
  full_name: string | null
  checked_in_at: string
}

// Az autó feloldása a beolvasott QR tokenből (a workspace-en belül).
export async function resolveCarByToken(token: string, workspaceId: string): Promise<Car | null> {
  const { data, error } = await supabase
    .from('cars')
    .select('*')
    .eq('qr_token', token)
    .eq('workspace_id', workspaceId)
    .eq('active', true)
    .maybeSingle()
  if (error) {
    console.error('Autó feloldási hiba:', error.message)
    return null
  }
  return data
}

// Adott autó + nap becsekkolt emberei (a napi páros)
export async function getCrewForDay(carId: string, date: string): Promise<CrewMember[]> {
  const { data, error } = await supabase
    .from('check_ins')
    .select('user_id, checked_in_at')
    .eq('car_id', carId)
    .eq('work_date', date)
    .order('checked_in_at')
  if (error) {
    console.error('Páros lekérési hiba:', error.message)
    return []
  }
  const names = await resolveNames((data ?? []).map((r) => r.user_id))
  return (data ?? []).map((r) => ({
    user_id: r.user_id,
    checked_in_at: r.checked_in_at,
    full_name: names[r.user_id] ?? null,
  }))
}

export type InspectionReason = Enums<'inspection_reason'>

export interface InspectionRequirement {
  required: boolean
  reasons: InspectionReason[] // day9 és/vagy driver_change
  lastDriverName?: string | null
}

// Kötelező autó-ellenőrző fotó, ha: a hónap 9-e VAN, VAGY az utolsó rögzített sofőr ≠ mai.
export async function checkInspectionRequirement(
  carId: string,
  userId: string,
  date: string,
): Promise<InspectionRequirement> {
  const reasons: InspectionReason[] = []

  // 9-e szabály
  const day = Number(date.slice(8, 10))
  if (day === 9) reasons.push('day9')

  // Sofőrváltás: a legutóbbi korábbi munkanap TELJES párosát nézzük.
  // (Csak a legutolsó becsekkolást nézve a stabil kétfős párosnál minden nap
  // tévesen "váltást" jelezne, mert a társ csekkolt be utoljára.)
  // Hiba esetén dobunk: a hívó (useQuery) újrapróbál — a kapu NEM nyílhat ki
  // pusztán azért, mert a lekérdezés átmenetileg elhasalt.
  const { data: lastDay, error } = await supabase
    .from('check_ins')
    .select('work_date')
    .eq('car_id', carId)
    .lt('work_date', date)
    .order('work_date', { ascending: false })
    .limit(1)
  if (error) throw new Error('Ellenőrzés-követelmény lekérdezési hiba: ' + error.message)

  let lastDriverName: string | null | undefined
  const prevDate = lastDay?.[0]?.work_date
  if (prevDate) {
    const { data: prevCrew, error: crewErr } = await supabase
      .from('check_ins')
      .select('user_id, checked_in_at')
      .eq('car_id', carId)
      .eq('work_date', prevDate)
      .order('checked_in_at', { ascending: false })
    if (crewErr) throw new Error('Ellenőrzés-követelmény lekérdezési hiba: ' + crewErr.message)
    const crewIds = new Set((prevCrew ?? []).map((r) => r.user_id))
    if (crewIds.size > 0) {
      const names = await resolveNames([...crewIds])
      lastDriverName = names[prevCrew![0].user_id] ?? null
      if (!crewIds.has(userId)) reasons.push('driver_change')
    }
  }

  return { required: reasons.length > 0, reasons, lastDriverName }
}
