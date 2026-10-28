import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { formatDateTime } from '../lib/labels'
import { toast } from '../lib/toast'
import Icon from './Icon'

// Javaslat / hibabejelentés a Profil oldalon: a munkatárs ír, az adminok pusht kapnak,
// a Naplóban látják és „kész”-re tehetik. A saját beküldéseit itt látja az állapotukkal.
export default function FeedbackCard() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const [kind, setKind] = useState<'suggestion' | 'bug'>('suggestion')
  const [text, setText] = useState('')
  const { data: mine } = useQuery({
    queryKey: ['feedback-mine', currentWorkspaceId, profile?.id],
    enabled: !!currentWorkspaceId && !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('feedback').select('id, kind, text, status, created_at')
        .eq('workspace_id', currentWorkspaceId!).eq('user_id', profile!.id).order('created_at', { ascending: false }).limit(10)
      if (error) throw error
      return data ?? []
    },
  })
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('feedback').insert({ workspace_id: currentWorkspaceId!, user_id: profile!.id, kind, text: text.trim() })
      if (error) throw error
    },
    onSuccess: () => { toast.success(kind === 'bug' ? 'Hibabejelentés elküldve — az admin értesítést kap.' : 'Javaslat elküldve — az admin értesítést kap.'); setText(''); void qc.invalidateQueries({ queryKey: ['feedback-mine'] }) },
    onError: (e) => toast.error('Nem sikerült elküldeni: ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })
  return (
    <div className="card stack">
      <div className="card-title"><Icon name="message-circle" />Javaslat / hibabejelentés</div>
      <div className="tabs compact" style={{ margin: 0 }}>
        <button type="button" className={kind === 'suggestion' ? 'active' : ''} onClick={() => setKind('suggestion')}><Icon name="info" size={18} />Javaslat</button>
        <button type="button" className={kind === 'bug' ? 'active' : ''} onClick={() => setKind('bug')}><Icon name="alert-triangle" size={18} />Hiba az appban</button>
      </div>
      <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={kind === 'bug' ? 'Mi történt, melyik oldalon, mit vártál helyette?' : 'Mit csinálnál másképp, mi hiányzik?'} />
      <button type="button" className="btn" disabled={text.trim().length < 5 || send.isPending} onClick={() => send.mutate()}>
        <Icon name="send" />{send.isPending ? 'Küldés…' : 'Küldés az adminnak'}
      </button>
      {(mine?.length ?? 0) > 0 && (
        <div className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div className="tiny muted" style={{ fontWeight: 700 }}>Korábbi beküldéseim</div>
          {mine!.map((f) => (
            <div key={f.id} className="between tiny" style={{ gap: 8, alignItems: 'flex-start' }}>
              <span style={{ minWidth: 0 }}><span className="muted">{f.kind === 'bug' ? 'Hiba' : 'Javaslat'} · {formatDateTime(f.created_at)}</span><br />{f.text}</span>
              <span className={`badge ${f.status === 'done' ? 'success' : ''}`} style={{ flexShrink: 0 }}>{f.status === 'done' ? 'kész' : 'új'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
