import Icon from './Icon'
import type { CrewDayCount } from '../lib/crewDayCounts'

// Fejenkénti napszám-kártya (heti és havi nézetben ugyanaz): Box / XL / betanuló / összes
export default function CrewDaysCard({ title, rows }: { title: string; rows: CrewDayCount[] }) {
  return (
    <div className="card stack">
      <div className="card-title"><Icon name="users" />{title}</div>
      {rows.length === 0 && <div className="tiny muted">Nincs munkatárs ezen a munkaterületen.</div>}
      <div className="tiny muted">Box = AlzaBox-szállító autón, XL = XL-es autón beosztott napok; az összes a különböző napok száma. Bet. = betanulóként beosztott napok (az összesben benne vannak).</div>
      <div className="grid-2">
        {rows.map((r) => (
          <div key={r.id} className="between" style={{ gap: 6 }}>
            <span className="small" style={{ fontWeight: r.count > 0 ? 700 : 400, color: r.count === 0 ? 'var(--text-dim)' : undefined, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
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
