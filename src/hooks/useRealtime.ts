import { useEffect } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Realtime: adott táblák változásaira meghívja a megadott query-k invalidálását.
let topicSeq = 0

export function useRealtimeInvalidate(channelId: string | null | undefined, tables: string[], queryKeys: QueryKey[]) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!channelId) return
    // Egyedi topic: azonos workspace-re két komponens ne osztozzon egy csatornán
    // (a supabase.channel() azonos névre a MEGLÉVŐ csatornát adná vissza)
    const ch = supabase.channel(`rt-${channelId}-${++topicSeq}`)
    for (const table of tables) {
      // workspace-szűrő: más munkaterületek eseményei ne invalidáljanak feleslegesen
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `workspace_id=eq.${channelId}` }, () => {
        for (const key of queryKeys) void qc.invalidateQueries({ queryKey: key })
      })
    }
    ch.subscribe()
    return () => { void supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, tables.join(','), JSON.stringify(queryKeys)])
}
