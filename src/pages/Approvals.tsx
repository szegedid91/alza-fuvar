import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import type { Enums, Tables } from '../lib/database.types'
import { roleLabel, formatDateTime } from '../lib/labels'
import { sendPush } from '../lib/push'

type Profile = Tables<'profiles'>
type AssignRole = Enums<'user_role'>

export default function Approvals() {
  const { profile } = useAuth()
  const { workspaces, currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const isAdmin = profile?.role === 'admin'

  const { data: pending, isLoading } = useQuery({
    queryKey: ['pending-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as Profile[]
    },
  })

  return (
    <div className="stack">
      <h2>Jóváhagyásra váró regisztrációk</h2>
      {isLoading && <div className="card"><div className="spinner" /></div>}
      {!isLoading && (pending?.length ?? 0) === 0 && (
        <div className="empty"><span className="ico">🎉</span>Nincs függőben lévő regisztráció.</div>
      )}
      {pending?.map((u) => (
        <PendingCard
          key={u.id}
          user={u}
          workspaces={workspaces}
          defaultWorkspaceId={currentWorkspaceId}
          allowAdmin={isAdmin}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ['pending-users'] })
            void qc.invalidateQueries({ queryKey: ['members'] })
          }}
        />
      ))}
    </div>
  )
}

function PendingCard({
  user, workspaces, defaultWorkspaceId, allowAdmin, onDone,
}: {
  user: Profile
  workspaces: { id: string; name: string }[]
  defaultWorkspaceId: string | null
  allowAdmin: boolean
  onDone: () => void
}) {
  const [role, setRole] = useState<AssignRole>('crew')
  // Származtatott érték: ha a workspace-lista a kártya után töltődik be
  // (cache-elt pending-lista), akkor is legyen alapértelmezett választás.
  const [wsOverride, setWsOverride] = useState<string | null>(null)
  const workspaceId = wsOverride ?? defaultWorkspaceId ?? workspaces[0]?.id ?? ''
  const [error, setError] = useState<string | null>(null)

  const approve = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('approve_user', {
        target_id: user.id,
        p_role: role,
        p_workspace_id: workspaceId,
      })
      if (error) throw error
      void sendPush([user.id], 'Fiók jóváhagyva', 'A fiókodat jóváhagyták, beléphetsz az Alza appba.', '/').catch(() => undefined)
    },
    onSuccess: onDone,
    onError: (e) => setError(e instanceof Error ? e.message : 'Hiba'),
  })

  const reject = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('set_user_status', { target_id: user.id, p_status: 'disabled' })
      if (error) throw error
    },
    onSuccess: onDone,
    onError: (e) => setError(e instanceof Error ? e.message : 'Hiba'),
  })

  const roles: AssignRole[] = allowAdmin ? ['crew', 'manager', 'admin'] : ['crew', 'manager']
  const busy = approve.isPending || reject.isPending

  return (
    <div className="card stack">
      <div className="between">
        <div>
          <div className="name" style={{ fontSize: 16, fontWeight: 700 }}>{user.full_name || user.email}</div>
          <div className="muted small">{user.email}</div>
        </div>
        <span className="tiny muted">{formatDateTime(user.created_at)}</span>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>Szerep</label>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as AssignRole)}>
            {roles.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Munkaterület</label>
          <select className="select" value={workspaceId} onChange={(e) => setWsOverride(e.target.value)}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="btn-grid">
        <button className="btn danger" disabled={busy} onClick={() => reject.mutate()}>Elutasítás</button>
        <button className="btn" disabled={busy || !workspaceId} onClick={() => { setError(null); approve.mutate() }}>Jóváhagyás</button>
      </div>
    </div>
  )
}
