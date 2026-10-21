import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useInspectionGate } from '../hooks/useInspectionGate'
import WaiverRequest from './WaiverRequest'
import Icon from './Icon'
import Skeleton from './Skeleton'

// Blokkolja a tartalmat, amíg a becsekkolás nem teljes (nincs körbefotózva az
// autó) — kivéve, ha a vezető fotó nélkül továbbengedte.
export default function InspectionGate({ carId, date, children }: { carId: string; date: string; children: ReactNode }) {
  const gate = useInspectionGate(carId, date)

  if (gate.loading) return <Skeleton rows={3} />

  // Ha nem tudtuk ellenőrizni (pl. nincs térerő), a kapu ZÁRVA marad —
  // hibából nem nyithat ki a kötelező fotózás megkerülésével.
  if (gate.error) {
    return (
      <div className="card stack" style={{ borderColor: 'var(--warning)' }}>
        <div className="row"><Icon name="wifi-off" size={26} style={{ color: 'var(--warning)' }} /><strong>Nem sikerült ellenőrizni a becsekkolás állapotát</strong></div>
        <p className="small muted">Valószínűleg nincs kapcsolat. Próbáld újra, amint van térerő.</p>
        <button className="btn secondary" onClick={gate.retry}><Icon name="refresh" />Újrapróbálás</button>
      </div>
    )
  }

  if (gate.blocked) {
    return (
      <div className="card stack" style={{ borderColor: 'var(--warning)' }}>
        <div className="row"><Icon name="ban" size={26} style={{ color: 'var(--warning)' }} /><strong>A becsekkolás még nem teljes</strong></div>
        <p className="small muted" style={{ margin: 0 }}>
          Előbb fotózd körbe az autót (5 kép: elöl, jobb, hátul, bal, fülke), utána folytathatod.
          {gate.reasons.includes('day9') && ' A hónap 9-e van.'}
          {gate.reasons.includes('driver_change') && ` Előző nap más ült az autóban${gate.lastDriverName ? ` (${gate.lastDriverName})` : ''}.`}
          {' '}Fotó nélkül csak a vezető engedhet tovább a saját fiókjából.
        </p>
        <Link to="/ellenorzes" className="btn" style={{ textDecoration: 'none' }}><Icon name="camera" />Fotózás indítása</Link>
        {gate.checkinId && <WaiverRequest checkinId={gate.checkinId} requestedAt={gate.helpRequestedAt} />}
      </div>
    )
  }

  return <>{children}</>
}
