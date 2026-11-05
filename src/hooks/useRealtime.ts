import { useEffect } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { subscribeWithRetry } from '../lib/realtimeRetry'

// Realtime: adott táblák változásaira meghívja a megadott query-k invalidálását.
let topicSeq = 0

export function useRealtimeInvalidate(channelId: string | null | undefined, tables: string[], queryKeys: QueryKey[]) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!channelId) return
    const invalidateAll = () => { for (const key of queryKeys) void qc.invalidateQueries({ queryKey: key }) }
    // Ha a csatorna elszakad (telefon háttérben, hálózatváltás, lejárt token), ÚJ csatornát nyitunk
    // (ugyanarra a példányra nem lehet másodszor feliratkozni), és a kimaradt eseményeket egy
    // frissítéssel pótoljuk — a vezetőnek ne kelljen újratöltenie
    const stop = subscribeWithRetry({
      create: () => {
        // Egyedi topic: azonos workspace-re két komponens ne osztozzon egy csatornán
        // (a supabase.channel() azonos névre a MEGLÉVŐ csatornát adná vissza)
        const ch = supabase.channel(`rt-${channelId}-${++topicSeq}`)
        for (const table of tables) {
          // workspace-szűrő: más munkaterületek eseményei ne invalidáljanak feleslegesen
          ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `workspace_id=eq.${channelId}` }, invalidateAll)
        }
        return ch
      },
      remove: (ch) => { void supabase.removeChannel(ch) },
      onSubscribed: invalidateAll,
    })
    // Előtérbe kerüléskor (háttérből vissza) mindig pótlás — a websocket közben alhatott
    const onVisible = () => { if (document.visibilityState === 'visible') invalidateAll() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', invalidateAll)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', invalidateAll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, tables.join(','), JSON.stringify(queryKeys)])
}
