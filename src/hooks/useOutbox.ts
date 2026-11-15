import { useEffect, useState } from 'react'
import { flushOutbox, listQueued, outboxCounts, subscribeOutbox, type OutboxRecord } from '../lib/outbox'

export function useOutboxStatus() {
  const [count, setCount] = useState(0)
  const [failed, setFailed] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    let active = true
    const refresh = () =>
      outboxCounts().then((c) => {
        if (!active) return
        setCount(c.pending)
        setFailed(c.failed)
      })
    refresh()
    const unsub = subscribeOutbox(refresh)

    const onOnline = () => {
      setOnline(true)
      void flushOutbox().then(refresh)
    }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    // induláskor és időnként próbáljuk üríteni a sort
    void flushOutbox().then(refresh)
    const interval = setInterval(() => {
      if (navigator.onLine) void flushOutbox().then(refresh)
    }, 20000)

    return () => {
      active = false
      unsub()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      clearInterval(interval)
    }
  }, [])

  return { count, failed, online }
}

// Egy tábla sorban álló (még fel nem küldött) írásai — a helyi sor minden változására frissül
export function useQueued(table: string): OutboxRecord[] {
  const [recs, setRecs] = useState<OutboxRecord[]>([])
  useEffect(() => {
    let active = true
    const refresh = () => { void listQueued(table).then((r) => { if (active) setRecs(r) }) }
    refresh()
    const unsub = subscribeOutbox(refresh)
    return () => { active = false; unsub() }
  }, [table])
  return recs
}

// Ugyanaz, betöltöttség-jelzéssel: az első kiolvasásig a lista üres — aki ebből dönt („nincs még ilyen sor, felveszem”),
// várja meg a `loaded` jelzést, különben a sorban álló mentés mellé egy második is létrejönne
export function useQueuedLoaded(table: string): { recs: OutboxRecord[]; loaded: boolean } {
  const [state, setState] = useState<{ recs: OutboxRecord[]; loaded: boolean }>({ recs: [], loaded: false })
  useEffect(() => {
    let active = true
    const refresh = () => { void listQueued(table).then((r) => { if (active) setState({ recs: r, loaded: true }) }, () => { if (active) setState((p) => ({ ...p, loaded: true })) }) }
    refresh()
    const unsub = subscribeOutbox(refresh)
    return () => { active = false; unsub() }
  }, [table])
  return state
}
