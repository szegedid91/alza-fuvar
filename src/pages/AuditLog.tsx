import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { resolveNames } from '../lib/names'
import { formatDateTime } from '../lib/labels'

const ENTITY_LABEL: Record<string, string> = {
  adjustments: 'Előleg/levonás', shifts: 'Beosztás', profiles: 'Felhasználó',
  evidence_photos: 'Bizonyíték', cars: 'Autó', fuel_logs: 'Tankolás',
}
const ACTION_LABEL: Record<string, string> = { INSERT: 'Létrehozás', UPDATE: 'Módosítás', DELETE: 'Törlés' }

export default function AuditLog() {
  const { data, isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: async () => {
      const { data } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100)
      const rows = data ?? []
      const names = await resolveNames(rows.map((r) => r.actor_id))
      return rows.map((r) => ({ ...r, actorName: r.actor_id ? names[r.actor_id] ?? 'Rendszer' : 'Rendszer' }))
    },
  })

  return (
    <div className="stack">
      <h2>Napló</h2>
      <p className="small muted">A módosítások nyomon követése (bér, beosztás, felhasználók, autók, bizonyítékok).</p>
      {isLoading && <div className="card"><div className="spinner" /></div>}
      {!isLoading && (data?.length ?? 0) === 0 && <div className="empty"><span className="ico">📜</span>Nincs naplóbejegyzés.</div>}
      {data?.map((r) => (
        <div key={r.id} className="card" style={{ padding: 12 }}>
          <div className="between">
            <div className="row" style={{ gap: 6 }}>
              <span className="badge primary">{ENTITY_LABEL[r.entity] ?? r.entity}</span>
              <span className={`badge ${r.action === 'DELETE' ? 'danger' : r.action === 'INSERT' ? 'success' : ''}`}>{ACTION_LABEL[r.action] ?? r.action}</span>
            </div>
            <span className="tiny muted">{formatDateTime(r.created_at)}</span>
          </div>
          <div className="small" style={{ marginTop: 6 }}>{r.actorName}</div>
        </div>
      ))}
    </div>
  )
}
