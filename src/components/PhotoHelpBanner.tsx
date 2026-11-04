import { Link } from 'react-router'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { usePhotoHelpRequests, useWaiveInspection } from '../lib/photoHelp'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

// Vezetői sáv MINDEN oldalon (mint az „Új verzió elérhető”): valaki fotó nélkül kér
// továbbengedést. Innen egyből továbbengedhető, vagy az Áttekintésre ugrik.
export default function PhotoHelpBanner() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const isLeader = profile?.role === 'manager' || profile?.role === 'admin'
  const { data } = usePhotoHelpRequests(isLeader)
  const waive = useWaiveInspection()
  useRealtimeInvalidate(isLeader ? currentWorkspaceId : null, ['check_ins', 'car_inspections'], [['photo-help']])
  if (!isLeader || !data || data.length === 0) return null
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="update-banner photo-help-banner" role="status">
      <div className="stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
        <Link to="/attekintes" className="row" style={{ gap: 8, color: 'inherit', textDecoration: 'none' }}>
          <Icon name="bell" />Engedélyt kér fotó nélkül ({data.length})
        </Link>
        {data.slice(0, 3).map((p) => (
          <div key={p.checkinId} className="between" style={{ gap: 8 }}>
            <span className="small" style={{ minWidth: 0, fontWeight: 600, lineHeight: 1.2 }}>
              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span className="tiny" style={{ opacity: 0.9, fontWeight: 500 }}><span className="num">{p.plate}</span> · kérte {hhmm(p.helpAt)}</span>
            </span>
            <ConfirmButton className="btn sm auto" confirmLabel="Biztos? Továbbengedem" disabled={waive.isPending} onConfirm={() => waive.mutate(p.checkinId)}>
              <Icon name="shield-check" size={14} />Továbbengedés
            </ConfirmButton>
          </div>
        ))}
        {data.length > 3 && <Link to="/attekintes" className="tiny" style={{ color: 'inherit' }}>és még {data.length - 3} — az Áttekintésben</Link>}
      </div>
    </div>
  )
}
