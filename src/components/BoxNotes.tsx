import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { cleanBoxNote, visibleBoxNotes, BOX_NOTE_MAX, type BoxNote } from '../lib/boxNotes'
import { resolveNames } from '../lib/names'
import { formatDate } from '../lib/labels'
import { toast } from '../lib/toast'
import { errMsg } from '../lib/errors'
import Icon from './Icon'

type NoteRow = BoxNote & { _name?: string | null }

// A vezető döntése egy megjegyzésről (jóváhagyás / elutasítás) — a Box-kártya és a Boxok oldali lista is ezt használja
export function useReviewBoxNote() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await supabase.from('box_notes').update({ status: approve ? 'approved' : 'rejected', reviewed_by: profile?.id ?? null, reviewed_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      return approve
    },
    onSuccess: (approve) => { toast.success(approve ? 'Jóváhagyva — mostantól mindenki látja.' : 'Elutasítva.'); void qc.invalidateQueries({ queryKey: ['box-notes'] }) },
    onError: (e) => toast.error('Nem sikerült: ' + errMsg(e, 'ismeretlen hiba')),
  })
}

// Munkatársi megjegyzések egy boxhoz a Box-kártyán: a jóváhagyottak mindenkinek, a függők a beküldőnek
// és a vezetőnek; új megjegyzés egy koppintásra, a vezető itt helyben jóváhagyhatja.
export default function BoxNotes({ boxId }: { boxId: string }) {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const isManager = profile?.role === 'manager' || profile?.role === 'admin'
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const review = useReviewBoxNote()

  const { data: notes } = useQuery({
    queryKey: ['box-notes', 'box', boxId, currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('box_notes').select('id, box_id, text, status, created_by, created_at, reviewed_at')
        .eq('box_id', boxId).eq('workspace_id', currentWorkspaceId!).order('created_at')
      if (error) throw error
      const rows = (data ?? []) as BoxNote[]
      const names = await resolveNames(rows.map((r) => r.created_by))
      return rows.map((r): NoteRow => ({ ...r, _name: names[r.created_by] ?? null }))
    },
  })

  const add = useMutation({
    mutationFn: async () => {
      const t = cleanBoxNote(text)
      if (!t) throw new Error('Írj legalább pár szót.')
      const { error } = await supabase.from('box_notes').insert({ workspace_id: currentWorkspaceId!, box_id: boxId, text: t, created_by: profile!.id })
      if (error) throw error
    },
    onSuccess: () => {
      setText(''); setOpen(false)
      toast.success(isManager ? 'Megjegyzés beküldve — vezetőként itt rögtön jóvá is hagyhatod.' : 'Köszönjük! A vezető jóváhagyása után mindenki látni fogja.')
      void qc.invalidateQueries({ queryKey: ['box-notes'] })
    },
    onError: (e) => toast.error(errMsg(e, 'A megjegyzés mentése nem sikerült')),
  })

  const v = visibleBoxNotes(notes ?? [], profile?.id ?? null, isManager)
  const Row = ({ n, pending }: { n: NoteRow; pending?: boolean }) => (
    <div className="small row" style={{ gap: 8, alignItems: 'flex-start' }}>
      <Icon name={pending ? 'clock' : 'users'} size={16} style={{ flexShrink: 0, marginTop: 2, color: pending ? 'var(--warning)' : 'var(--primary)' }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div>{n.text}</div>
        <div className="tiny muted">{n._name ?? 'munkatárs'} · {formatDate(n.created_at.slice(0, 10))}{pending ? ' · jóváhagyásra vár' : ''}</div>
        {pending && isManager && (
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            <button type="button" className="btn sm auto" disabled={review.isPending} onClick={() => review.mutate({ id: n.id, approve: true })}><Icon name="check" size={14} />Jóváhagyás</button>
            <button type="button" className="btn ghost sm auto" disabled={review.isPending} onClick={() => review.mutate({ id: n.id, approve: false })}><Icon name="x" size={14} />Elutasítás</button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="stack" style={{ gap: 6 }}>
      {(v.approved.length > 0 || v.pending.length > 0) && <div className="tiny muted" style={{ fontWeight: 700 }}>Munkatársak megjegyzései</div>}
      {v.approved.map((n) => <Row key={n.id} n={n} />)}
      {v.pending.map((n) => <Row key={n.id} n={n} pending />)}
      {v.rejectedMine.length > 0 && <div className="tiny muted">{v.rejectedMine.length} megjegyzésedet a vezető nem fogadta el.</div>}
      {open ? (
        <div className="stack" style={{ gap: 6 }}>
          <textarea className="textarea" rows={2} maxLength={BOX_NOTE_MAX} value={text} autoFocus onChange={(e) => setText(e.target.value)}
            placeholder="pl. a hátsó bejáratnál van, kapukód a portán; parkolni a Penny mögött lehet" />
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn sm auto" disabled={add.isPending || !cleanBoxNote(text)} onClick={() => add.mutate()}><Icon name="send" size={14} />Beküldés</button>
            <button type="button" className="btn ghost sm auto" onClick={() => { setOpen(false); setText('') }}>Mégse</button>
          </div>
          <div className="tiny muted">A vezető jóváhagyása után minden munkatárs látja a box kártyáján.</div>
        </div>
      ) : (
        <button type="button" className="link-btn tiny" style={{ alignSelf: 'flex-start', padding: '4px 0' }} onClick={() => setOpen(true)}>
          <Icon name="plus" size={12} /> Megjegyzés hozzáadása (hol van, hogyan találod meg)
        </button>
      )}
    </div>
  )
}

// Vezetőnek: a munkaterület összes jóváhagyásra váró box-megjegyzése egy helyen (Boxok oldal)
export function PendingBoxNotesCard() {
  const { currentWorkspaceId } = useWorkspace()
  const review = useReviewBoxNote()
  const { data } = useQuery({
    queryKey: ['box-notes', 'pending', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase.from('box_notes').select('id, box_id, text, status, created_by, created_at, reviewed_at, box:alza_boxes(code, name)')
        .eq('workspace_id', currentWorkspaceId!).eq('status', 'pending').order('created_at')
      if (error) throw error
      const rows = (data ?? []) as unknown as (BoxNote & { box: { code: string | null; name: string } | null })[]
      const names = await resolveNames(rows.map((r) => r.created_by))
      return rows.map((r) => ({ ...r, _name: names[r.created_by] ?? null }))
    },
  })
  if (!data || data.length === 0) return null
  return (
    <div className="card stack" style={{ gap: 8, borderColor: 'var(--warning)' }}>
      <div className="card-title" style={{ margin: 0 }}><Icon name="users" />Box-megjegyzések jóváhagyásra ({data.length})</div>
      <div className="tiny muted">A munkatársak írták a boxok kártyájára. Jóváhagyás után mindenki látja, elutasítva csak a beküldő tudja meg.</div>
      {data.map((n) => (
        <div key={n.id} className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          <div className="small" style={{ fontWeight: 700 }}>{n.box?.code ? `${n.box.code} · ` : ''}{n.box?.name ?? 'box'}</div>
          <div className="small">{n.text}</div>
          <div className="between">
            <span className="tiny muted">{n._name ?? 'munkatárs'} · {formatDate(n.created_at.slice(0, 10))}</span>
            <span className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm auto" disabled={review.isPending} onClick={() => review.mutate({ id: n.id, approve: true })}><Icon name="check" size={14} />Jóváhagyás</button>
              <button type="button" className="btn ghost sm auto" disabled={review.isPending} onClick={() => review.mutate({ id: n.id, approve: false })}><Icon name="x" size={14} />Elutasítás</button>
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
