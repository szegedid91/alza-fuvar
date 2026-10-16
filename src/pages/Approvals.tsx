import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import type { Enums, Tables } from '../lib/database.types'
import { roleLabel, formatDateTime } from '../lib/labels'
import { sendPush } from '../lib/push'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'
import ConfirmButton from '../components/ConfirmButton'
import { telHref } from '../lib/names'

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
      <p className="small muted" style={{ margin: 0 }}>
        Az új regisztráció itt jelenik meg; a szerep és a munkaterület megadása után a munkatárs azonnal beléphet.
      </p>
      {isLoading && <Skeleton rows={4} />}
      {!isLoading && (pending?.length ?? 0) === 0 && (
        <div className="empty">
          <span className="ico"><Icon name="user-check" size={40} /></span>
          Nincs függőben lévő regisztráció.
          <div className="tiny muted" style={{ marginTop: 6 }}>Új regisztrációról push-értesítést kapsz. Az elutasítottak a Tagok oldalon „letiltott" állapotban vannak, onnan visszaengedhetők.</div>
        </div>
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
    <div className="card stack primary">
      {/* Telefonon szűk a hely: a dátum és a telefon a név ALÁ kerül, nem mellé */}
      <div className="row" style={{ gap: 12, minWidth: 0, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
            background: 'var(--primary-ghost)', color: 'var(--primary)',
          }}
        >
          <Icon name="user" size={20} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="name" style={{ fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.full_name || user.email}</div>
          <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
          <div className="tiny muted">Regisztrált: {formatDateTime(user.created_at)}</div>
          {/* Telefon, ha megadta — egy koppintással hívható, hogy a vezető ellenőrizze, ki regisztrált */}
          {user.phone && (
            telHref(user.phone)
              ? <a className="small row" href={telHref(user.phone)!} style={{ gap: 4, textDecoration: 'none', marginTop: 2 }}><Icon name="phone" size={14} />{user.phone}</a>
              : <div className="muted small">{user.phone}</div>
          )}
        </div>
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

      {/* Az elutasítás letiltott állapotba teszi (a Tagok oldalon visszafordítható) — ezért nem piros,
          de két koppintás: a két gomb egymás mellett van, a félrekoppintás ne tiltson le senkit */}
      <div className="stop-actions">
        <ConfirmButton className="btn ghost" confirmLabel="Biztos? Elutasítás" disabled={busy} onConfirm={() => { setError(null); reject.mutate() }}>
          {reject.isPending ? 'Elutasítás…' : 'Elutasítás'}
        </ConfirmButton>
        <button className="btn" disabled={busy || !workspaceId} onClick={() => { setError(null); approve.mutate() }}>
          <Icon name="check" />{approve.isPending ? 'Jóváhagyás…' : 'Jóváhagyás'}
        </button>
      </div>
    </div>
  )
}
