import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { groupUnmapped, type UnmappedRow } from '../lib/boxUnmapped'
import { formatDate } from '../lib/labels'
import { toast } from '../lib/toast'
import { errMsg } from '../lib/errors'
import Icon from './Icon'

// Admin: a Box-lap képkiolvasásakor talált, egyik mezőhöz sem sorolható kijelző-üzenetek,
// előfordulás szerint. Ha egy üzenet rendszeresen visszatér, érdemes rá külön mezőt nyitni a lapon.
export default function UnmappedMessagesCard() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  const { data: rows } = useQuery({
    queryKey: ['box-unmapped', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('box_unmapped_messages').select('id, text, text_key, box_code, created_at, resolved_at')
        .eq('workspace_id', currentWorkspaceId!).is('resolved_at', null).order('created_at', { ascending: false }).limit(500)
      if (error) throw error
      return data as UnmappedRow[]
    },
  })
  const groups = groupUnmapped(rows ?? [])

  // „Elintézve”: az üzenet összes előfordulása lezárva (pl. mező lett rá, vagy nem kell)
  const resolve = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('box_unmapped_messages').update({ resolved_at: new Date().toISOString(), resolved_by: profile?.id ?? null }).in('id', ids)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Elintézettnek jelölve.'); void qc.invalidateQueries({ queryKey: ['box-unmapped'] }) },
    onError: (e) => toast.error('Nem sikerült: ' + errMsg(e, 'ismeretlen hiba')),
  })

  if (!rows) return null
  const total = groups.reduce((x, g) => x + g.count, 0)

  return (
    <div className="card stack" style={{ gap: 8, borderColor: groups.length ? 'var(--warning)' : undefined }}>
      <button type="button" className="between" style={{ background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', gap: 8 }} onClick={() => setOpen((o) => !o)}>
        <div>
          <div className="card-title" style={{ margin: 0 }}><Icon name="alert-triangle" />Kijelző-üzenetek mező nélkül</div>
          <div className="tiny muted">
            {groups.length === 0
              ? 'A képkiolvasás eddig minden kijelző-üzenetet be tudott sorolni egy mezőbe.'
              : `${groups.length} féle üzenet, ${total} előfordulás — ha egy rendszeresen visszatér, kellhet rá új mező a Box-lapon.`}
          </div>
        </div>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} />
      </button>
      {open && groups.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="tiny muted">A kiolvasó ezeket a megálló megjegyzésébe írta. Az „Elintézve” lezárja az üzenet összes eddigi előfordulását; ha újra felbukkan, megint megjelenik itt.</div>
          {groups.map((g) => (
            <div key={g.key} className="between" style={{ gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ minWidth: 0 }}>
                <div className="small" style={{ fontWeight: 700 }}>{g.text}</div>
                <div className="tiny muted">
                  <strong>{g.count}×</strong>{g.boxes.length ? ` · ${g.boxes.slice(0, 6).join(', ')}${g.boxes.length > 6 ? ` +${g.boxes.length - 6}` : ''}` : ''}
                  {' · '}{g.first.slice(0, 10) === g.last.slice(0, 10) ? formatDate(g.last.slice(0, 10)) : `${formatDate(g.first.slice(0, 10))} – ${formatDate(g.last.slice(0, 10))}`}
                </div>
              </div>
              <button type="button" className="btn ghost sm auto" disabled={resolve.isPending} style={{ whiteSpace: 'nowrap' }} onClick={() => resolve.mutate(g.ids)}>
                <Icon name="check" size={14} />Elintézve
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
