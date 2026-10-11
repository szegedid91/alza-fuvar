import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Icon from './Icon'

// Offline, és az aktuális oldalhoz nincs mentett adat: a react-query ilyenkor
// "szünetelteti" a lekérdezést (fetchStatus: paused), a spinner pedig örökké
// pörögne. Ez a sáv megmondja, mi a helyzet.
export default function OfflineHint() {
  const qc = useQueryClient()
  const [show, setShow] = useState(false)

  useEffect(() => {
    const check = () => {
      if (navigator.onLine) { setShow(false); return }
      const stuck = qc.getQueryCache().getAll().some((q) =>
        q.state.fetchStatus === 'paused' && q.state.data === undefined && q.getObserversCount() > 0)
      setShow(stuck)
    }
    // A cache-esemény egy MÁSIK komponens renderelése közben is jöhet (a
    // useQuery feliratkozásakor) — a setState-et a render után futtatjuk,
    // különben React "Cannot update a component while rendering" hibát ad.
    let queued = false
    const schedule = () => {
      if (queued) return
      queued = true
      queueMicrotask(() => { queued = false; check() })
    }
    check()
    const unsub = qc.getQueryCache().subscribe(schedule)
    window.addEventListener('online', schedule)
    window.addEventListener('offline', schedule)
    return () => { unsub(); window.removeEventListener('online', schedule); window.removeEventListener('offline', schedule) }
  }, [qc])

  if (!show) return null
  return (
    <div className="alert error row" style={{ margin: '0 0 12px', gap: 10 }}>
      <Icon name="wifi-off" />Nincs kapcsolat — ehhez az oldalhoz még nincs letöltött adat. Amint visszajön a hálózat, magától betölt.
    </div>
  )
}
