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
    const invalidateNow = () => { for (const key of queryKeys) void qc.invalidateQueries({ queryKey: key }) }
    // Összevonás: egy járatterv-import vagy átrendezés több száz sor-eseményt küld — ezekre EGY frissítés megy
    // (az utolsó esemény után 400 ms-mal), nem eseményenként egy megszakított és újraindított letöltés
    let timer: ReturnType<typeof setTimeout> | null = null
    const invalidateAll = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; invalidateNow() }, 400) }
    // az első feliratkozáskor a lekérdezések amúgy is frissen töltődnek — csak az ÚJRAcsatlakozás pótol
    let subscribedOnce = false
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
      onSubscribed: () => { if (subscribedOnce) invalidateAll(); subscribedOnce = true },
    })
    // Előtérbe kerüléskor a pótlást a főmodul (main.tsx) végzi minden elavult aktív lekérdezésre — itt külön
    // nem ismételjük (korábban ugyanazok a kérések kétszer mentek ki, és az első megszakadt)
    window.addEventListener('online', invalidateAll)
    return () => {
      stop()
      if (timer) clearTimeout(timer)
      window.removeEventListener('online', invalidateAll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, tables.join(','), JSON.stringify(queryKeys)])
}
