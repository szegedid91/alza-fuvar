import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { resolveNames } from '../lib/names'
import { formatDateTime } from '../lib/labels'
import { toast } from '../lib/toast'
import Icon from './Icon'

// Adminnak: a munkatársak javaslatai és hibabejelentései (Napló oldal), „kész” jelöléssel
export default function FeedbackList() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  useRealtimeInvalidate(currentWorkspaceId, ['feedback'], [['feedback-all']])
  const { data } = useQuery({
    queryKey: ['feedback-all', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('feedback').select('id, user_id, kind, text, status, created_at, resolved_at')
        .eq('workspace_id', currentWorkspaceId!).order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      const rows = data ?? []
      const names = await resolveNames(rows.map((r) => r.user_id))
      return rows.map((r) => ({ ...r, name: names[r.user_id] ?? 'Munkatárs' }))
    },
  })
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'new' | 'done' }) => {
      const { error } = await supabase.from('feedback').update({ status, resolved_at: status === 'done' ? new Date().toISOString() : null, resolved_by: status === 'done' ? profile!.id : null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['feedback-all'] }),
    onError: (e) => toast.error('Nem sikerült: ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })
  const open = (data ?? []).filter((f) => f.status === 'new')
  const done = (data ?? []).filter((f) => f.status === 'done')
  return (
    <div className="card stack">
      <div className="card-title" style={{ margin: 0 }}><Icon name="message-circle" />Javaslatok és hibabejelentések{open.length ? ` (${open.length} új)` : ''}</div>
      {(data?.length ?? 0) === 0 && <div className="tiny muted">Még nem érkezett beküldés. A munkatársak a Profil oldalon írhatnak.</div>}
      {[...open, ...done].map((f) => (
        <div key={f.id} className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8, opacity: f.status === 'done' ? 0.6 : 1 }}>
          <div className="between" style={{ gap: 8 }}>
            <span className="small"><span className={`badge ${f.kind === 'bug' ? 'danger' : ''}`} style={{ marginRight: 6 }}>{f.kind === 'bug' ? 'Hiba' : 'Javaslat'}</span><strong>{f.name}</strong></span>
            <span className="tiny muted" style={{ flexShrink: 0 }}>{formatDateTime(f.created_at)}</span>
          </div>
          <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{f.text}</div>
          <button type="button" className="btn ghost sm auto" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: f.id, status: f.status === 'done' ? 'new' : 'done' })}>
            <Icon name={f.status === 'done' ? 'repeat' : 'check'} size={14} />{f.status === 'done' ? 'Újra nyitás' : 'Kész'}
          </button>
        </div>
      ))}
    </div>
  )
}
