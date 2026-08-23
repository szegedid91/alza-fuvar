import { supabase } from './supabase'
import type { Tables } from './database.types'

export type FuelLog = Tables<'fuel_logs'>

// Az adott autó legutóbbi tankolása a jelenleginél kisebb km-óra állással.
export async function previousFuelForCar(carId: string, currentKm: number): Promise<FuelLog | null> {
  const { data } = await supabase
    .from('fuel_logs')
    .select('*')
    .eq('car_id', carId)
    .lt('odometer_km', currentKm)
    .order('odometer_km', { ascending: false })
    .limit(1)
  return data?.[0] ?? null
}

// Van-e olyan tankolás, aminek km-je >= a mostani? (visszafelé / hibás km jelzés)
export async function hasLaterOrEqualKm(carId: string, currentKm: number): Promise<boolean> {
  const { count } = await supabase
    .from('fuel_logs')
    .select('id', { count: 'exact', head: true })
    .eq('car_id', carId)
    .gte('odometer_km', currentKm)
  return (count ?? 0) > 0
}

// Fogyasztás = a mostani tankolás litere / megtett km × 100
export function computeConsumption(liters: number, currentKm: number, prevKm: number): number | null {
  const dist = currentKm - prevKm
  if (dist <= 0) return null
  return Math.round((liters / dist) * 100 * 100) / 100
}

// Az autó átlagfogyasztása a rögzített (számított) fogyasztásokból.
export async function carAverageConsumption(carId: string): Promise<number | null> {
  const { data } = await supabase
    .from('fuel_logs')
    .select('consumption')
    .eq('car_id', carId)
    .not('consumption', 'is', null)
  const vals = (data ?? []).map((r) => r.consumption as number).filter((n) => n != null && n > 0)
  if (vals.length === 0) return null
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
}
