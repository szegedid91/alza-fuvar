import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useInspectionGate } from '../hooks/useInspectionGate'

// Blokkolja a tartalmat, amíg a kötelező autó-ellenőrzés nincs kész.
export default function InspectionGate({ carId, date, children }: { carId: string; date: string; children: ReactNode }) {
  const gate = useInspectionGate(carId, date)

  if (gate.loading) return <div className="card"><div className="spinner" /></div>

  // Ha nem tudtuk ellenőrizni a követelményt (pl. nincs térerő), a kapu
  // ZÁRVA marad — hibából nem nyithat ki a kötelező ellenőrzés megkerülésével.
  if (gate.error) {
    return (
      <div className="card stack" style={{ borderColor: 'var(--warning)' }}>
        <div className="row"><span style={{ fontSize: 26 }}>📶</span><strong>Nem sikerült ellenőrizni a követelményeket</strong></div>
        <p className="small muted">Valószínűleg nincs kapcsolat. Próbáld újra, amint van térerő.</p>
        <button className="btn secondary" onClick={gate.retry}>🔄 Újrapróbálás</button>
      </div>
    )
  }

  if (gate.blocked) {
    return (
      <div className="card stack" style={{ borderColor: 'var(--warning)' }}>
        <div className="row"><span style={{ fontSize: 26 }}>⛔</span><strong>Kötelező ellenőrzés szükséges</strong></div>
        <p className="small muted">
          {gate.reasons.includes('day9') && 'A hónap 9-e van. '}
          {gate.reasons.includes('driver_change') && `Előző nap más ült az autóban${gate.lastDriverName ? ` (${gate.lastDriverName})` : ''}. `}
          Előbb készítsd el az ellenőrző fotókat (elöl/hátul/bal/jobb/beltér), utána folytathatod.
        </p>
        <Link to="/ellenorzes" className="btn" style={{ textDecoration: 'none' }}>Ellenőrzés indítása</Link>
      </div>
    )
  }

  return <>{children}</>
}
