import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAuth } from '../context/AuthContext'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { resolveNames } from '../lib/names'
import Icon from './Icon'

// Vezetői kezdőlap / Áttekintés: élő segítségkérések
export default function HelpSessionsCard() {
  const { currentWorkspaceId } = useWorkspace()
  const { profile } = useAuth()
  useRealtimeInvalidate(currentWorkspaceId, ['help_sessions'], [['help-sessions']])
  const { data } = useQuery({
    queryKey: ['help-sessions', currentWorkspaceId, 'active'],
    enabled: !!currentWorkspaceId,
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await supabase.from('help_sessions').select('id, user_id, started_at, last_seen_at, path, note')
        .eq('workspace_id', currentWorkspaceId!).is('ended_at', null).gt('last_seen_at', new Date(Date.now() - 90_000).toISOString()).order('started_at', { ascending: false })
      if (error) throw error
      const names = await resolveNames((data ?? []).map((r) => r.user_id))
      return (data ?? []).filter((r) => r.user_id !== profile?.id).map((r) => ({ ...r, name: names[r.user_id] ?? '?' }))
    },
  })
  if (!data || data.length === 0) return null
  return (
    <div className="card stack" style={{ borderColor: 'var(--warning)', gap: 6 }}>
      <div className="card-title" style={{ margin: 0 }}><Icon name="life-buoy" style={{ color: 'var(--warning)' }} />Segítséget kér ({data.length})</div>
      {data.map((r) => (
        <Link key={r.id} to={`/elo-nezet/${r.id}`} className="between" style={{ textDecoration: 'none', color: 'inherit', gap: 8 }}>
          <span className="small"><strong>{r.name}</strong>{r.note ? ` — ${r.note}` : ''} <span className="muted">· {r.path}</span></span>
          <span className="badge warning">Élő nézet <Icon name="chevron-right" size={12} /></span>
        </Link>
      ))}
    </div>
  )
}
