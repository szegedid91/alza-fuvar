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
    const invalidateAll = () => { for (const key of queryKeys) void qc.invalidateQueries({ queryKey: key }) }
    // Ha a csatorna elszakad (telefon háttérben, hálózatváltás), újra feliratkozunk, és a
    // kimaradt eseményeket egy frissítéssel pótoljuk — a vezetőnek ne kelljen újratöltenie
    let retry: ReturnType<typeof setTimeout> | null = null
    let closed = false
    const subscribe = () => ch.subscribe((status) => {
      if (closed) return
      if (status === 'SUBSCRIBED') invalidateAll()
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (retry) clearTimeout(retry)
        retry = setTimeout(() => { if (!closed) subscribe() }, 3000)
      }
    })
    subscribe()
    // Előtérbe kerüléskor (háttérből vissza) mindig pótlás — a websocket közben alhatott
    const onVisible = () => { if (document.visibilityState === 'visible') invalidateAll() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', invalidateAll)
    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', invalidateAll)
      void supabase.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, tables.join(','), JSON.stringify(queryKeys)])
}
