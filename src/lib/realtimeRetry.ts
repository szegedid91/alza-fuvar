// Realtime-csatorna megszakadás utáni újranyitása.
// FONTOS: egy csatorna-példányra csak EGYSZER lehet feliratkozni — a lezárt (CLOSED) példány
// újbóli subscribe()-ja „tried to join multiple times” hibát dob (ez került a Hibák listába, és
// utána a valós idejű frissítés az oldal újratöltéséig nem állt helyre). Ezért megszakadáskor a
// régi példányt eldobjuk, és ÚJ csatornát nyitunk; a régi példány kései visszahívásait nem nézzük.

export type ChannelStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'
export interface ChannelLike { subscribe: (cb: (status: ChannelStatus | string) => void) => unknown }

export interface ResubscribeOptions<C extends ChannelLike> {
  // új, még fel nem iratkozott csatorna (egyedi névvel, a figyelők már rákötve)
  create: () => C
  // a megszakadt / feleslegessé vált csatorna eltávolítása
  remove: (ch: C) => void
  // sikeres (újra)feliratkozás — itt pótolható, ami a szakadás alatt kimaradt
  onSubscribed: () => void
  // újrapróbálkozás késleltetése az egymást követő sikertelen kísérletek száma szerint
  delayMs?: (attempt: number) => number
}

// 3 mp, 6, 12, 24, legfeljebb 30 mp — tartós hiba (pl. lejárt belépés) ne pörgesse a kapcsolatot
export const defaultRetryDelay = (attempt: number): number => Math.min(30_000, 3_000 * 2 ** Math.min(attempt, 4))

// Elindítja a feliratkozást; a visszaadott függvény leállítja (és eltávolítja az élő csatornát).
export function subscribeWithRetry<C extends ChannelLike>(opts: ResubscribeOptions<C>): () => void {
  const delay = opts.delayMs ?? defaultRetryDelay
  let stopped = false
  let generation = 0
  let attempt = 0
  let current: C | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const open = () => {
    const mine = ++generation
    const ch = opts.create()
    current = ch
    ch.subscribe((status) => {
      if (stopped || mine !== generation) return // leállítva, vagy ez már egy eldobott példány
      if (status === 'SUBSCRIBED') { attempt = 0; opts.onSubscribed(); return }
      if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT' && status !== 'CLOSED') return
      if (timer) return // erre a példányra már be van ütemezve a csere
      timer = setTimeout(() => {
        timer = null
        if (stopped || mine !== generation) return
        generation++ // a régi példány további jelzései innentől nem számítanak
        attempt++
        try { opts.remove(ch) } catch { /* már le van zárva */ }
        open()
      }, delay(attempt))
    })
  }
  open()

  return () => {
    stopped = true
    if (timer) { clearTimeout(timer); timer = null }
    const ch = current
    current = null
    if (ch) { try { opts.remove(ch) } catch { /* már le van zárva */ } }
  }
}
