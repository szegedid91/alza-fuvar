import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useInspectionGate } from '../hooks/useInspectionGate'

// Blokkolja a tartalmat, amíg a kötelező autó-ellenőrzés nincs kész.
export default function InspectionGate({ carId, date, children }: { carId: string; date: string; children: ReactNode }) {
  const gate = useInspectionGate(carId, date)

  if (gate.loading) return <div className="card"><div className="spinner" /></div>

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
