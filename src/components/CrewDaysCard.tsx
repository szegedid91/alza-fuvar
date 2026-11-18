import Icon from './Icon'
import type { CrewDayCount } from '../lib/crewDayCounts'

// Fejenkénti napszám-kártya (heti és havi nézetben ugyanaz): Box / XL / betanuló / összes
export default function CrewDaysCard({ title, rows }: { title: string; rows: CrewDayCount[] }) {
  return (
    <div className="card stack">
      <div className="card-title"><Icon name="users" />{title}</div>
      {rows.length === 0 && <div className="tiny muted">Nincs munkatárs ezen a munkaterületen.</div>}
      <div className="tiny muted">Box = AlzaBox-szállító autón, XL = XL-es autón beosztott napok; az összes a különböző napok száma. Bet. = betanulóként beosztott napok (az összesben benne vannak).</div>
      {/* Telefonon egy oszlop, és ha a jelvények mellett nem fér ki a név, a jelvények a név ALÁ kerülnek —
          korábban két oszlopban a jelvények az egész helyet elvitték, a névből semmi nem látszott */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 330px), 1fr))', gap: '0 16px' }}>
        {rows.map((r) => (
          <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '3px 8px', padding: '6px 0', borderBottom: '1px solid var(--border)', minWidth: 0 }}>
            <span className="small" style={{ flex: '1 1 150px', minWidth: 0, overflowWrap: 'anywhere', fontWeight: r.count > 0 ? 700 : 400, color: r.count === 0 ? 'var(--text-dim)' : undefined }}>{r.name}</span>
            <span className="row" style={{ gap: 4, flexShrink: 0 }}>
              <span className={`badge ${r.box > 0 ? 'warning' : ''}`} title="Box-os napok">Box {r.box}</span>
              <span className={`badge ${r.xl > 0 ? 'success' : ''}`} title="XL-es napok">XL {r.xl}</span>
              {r.trainee > 0 && <span className="badge" title="Betanulóként beosztott napok" style={{ background: 'var(--primary-ghost)', color: 'var(--primary)', borderColor: 'transparent' }}>Bet. {r.trainee}</span>}
              <span className={`badge ${r.count > 0 ? 'primary' : ''}`}>{r.count} nap</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
