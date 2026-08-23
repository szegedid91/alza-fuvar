import { useEffect, useState } from 'react'
import { flushOutbox, outboxCounts, subscribeOutbox } from '../lib/outbox'

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
