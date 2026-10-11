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
    check()
    const unsub = qc.getQueryCache().subscribe(check)
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
    return () => { unsub(); window.removeEventListener('online', check); window.removeEventListener('offline', check) }
  }, [qc])

  if (!show) return null
  return (
    <div className="alert error row" style={{ margin: '0 0 12px', gap: 10 }}>
      <Icon name="wifi-off" />Nincs kapcsolat — ehhez az oldalhoz még nincs letöltött adat. Amint visszajön a hálózat, magától betölt.
    </div>
  )
}
