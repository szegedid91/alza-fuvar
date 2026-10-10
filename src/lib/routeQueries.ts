import type { QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Tables } from './database.types'

export type RouteUpload = Tables<'route_uploads'>
export type RouteStop = Tables<'route_stops'>

// A fuvarterv lekérdezései EGY helyen: a Fuvar oldal és a becsekkolás utáni
// előtöltés ugyanazt a kulcsot/függvényt használja, így a sofőr a Fuvar
// oldalra lépve már a cache-ből kapja a stopokat (nincs 3-4 soros kör).

export function routeUploadQuery(workspaceId: string, carId: string, date: string) {
  return {
    queryKey: ['route-upload', workspaceId, carId, date] as const,
    queryFn: async (): Promise<RouteUpload | null> => {
      const { data, error } = await supabase.from('route_uploads').select('*')
        .eq('workspace_id', workspaceId).eq('car_id', carId).eq('work_date', date)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      // Hiba esetén dobni kell — különben "nincs fuvarterv"-nek látszana, és
      // a sofőr duplán importálná a tervet.
      if (error) throw error
      return (data as RouteUpload | null) ?? null
    },
  }
}

export function routeStopsQuery(uploadId: string) {
  return {
    queryKey: ['route-stops', uploadId] as const,
    queryFn: async (): Promise<RouteStop[]> => {
      const { data, error } = await supabase.from('route_stops').select('*').eq('upload_id', uploadId)
        .order('display_order', { ascending: true, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as RouteStop[]
    },
  }
}

// Becsekkolás után: a mai fuvarterv + stopok előtöltése a háttérben.
// Best effort — hiba esetén csendben marad, a Fuvar oldal úgyis újrakéri.
export async function prefetchRoute(qc: QueryClient, workspaceId: string, carId: string, date: string): Promise<void> {
  try {
    const upload = await qc.fetchQuery(routeUploadQuery(workspaceId, carId, date))
    if (upload) await qc.prefetchQuery(routeStopsQuery(upload.id))
  } catch { /* offline vagy jogosultsági hiba — a Fuvar oldal kezeli */ }
}
