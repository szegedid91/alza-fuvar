import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import type { Enums, Tables } from '../lib/database.types'
import { roleLabel, statusLabel, formatDateTime } from '../lib/labels'
import { qrDataUrl } from '../lib/qr'
import ConfirmButton from '../components/ConfirmButton'

type Profile = Tables<'profiles'>
type Invite = Tables<'invites'>

// Meghívó: a link/QR birtokosának csak jelszót kell beállítania — azonnal aktív tag lesz
function InviteCard() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const isAdmin = profile?.role === 'admin'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Enums<'user_role'>>('crew')
  const [error, setError] = useState<string | null>(null)
  const [qrFor, setQrFor] = useState<string | null>(null) // invite id, amihez QR látszik
  const [qrImg, setQrImg] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const { data: invites } = useQuery({
    queryKey: ['invites', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('invites').select('*')
        .eq('workspace_id', currentWorkspaceId!).order('created_at', { ascending: false }).limit(20)
      if (error) throw error
      return data as Invite[]
    },
  })

  const create = useMutation({
    mutationFn: async () => {
      const em = email.trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw new Error('Érvénytelen email-cím.')
      const { error } = await supabase.from('invites').insert({
        workspace_id: currentWorkspaceId!, email: em,
        full_name: name.trim() || null, role, created_by: profile!.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setError(null); setName(''); setEmail(''); setRole('crew')
      void qc.invalidateQueries({ queryKey: ['invites'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'A meghívó létrehozása nem sikerült'),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('invites').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['invites'] }),
  })

  const linkOf = (id: string) => `${window.location.origin}/meghivo/${id}`

  async function copyLink(id: string) {
    try {
      await navigator.clipboard.writeText(linkOf(id))
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      window.prompt('Másold ki a linket:', linkOf(id))
    }
  }

  async function toggleQr(id: string) {
    if (qrFor === id) { setQrFor(null); setQrImg(null); return }
    setQrFor(id)
    setQrImg(await qrDataUrl(linkOf(id)))
  }

  async function shareLink(inv: Invite) {
    const url = linkOf(inv.id)
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Alza meghívó', text: `Meghívó az Alza appba (${inv.full_name || inv.email})`, url })
      } catch { /* a megosztás megszakítva */ }
    } else {
      void copyLink(inv.id)
    }
  }

  const stateOf = (i: Invite): { label: string; cls: string } => {
    if (i.used_at) return { label: 'Felhasználva', cls: 'success' }
    if (new Date(i.expires_at).getTime() < Date.now()) return { label: 'Lejárt', cls: 'danger' }
    return { label: 'Aktív', cls: 'primary' }
  }

  const activeCount = (invites ?? []).filter((i) => !i.used_at && new Date(i.expires_at).getTime() > Date.now()).length

  if (!expanded) {
    return (
      <div className="card">
        <div className="between">
          <div>
            <div className="card-title" style={{ margin: 0 }}>✉️ Meghívók</div>
            <div className="tiny muted">{activeCount > 0 ? `${activeCount} aktív meghívó` : 'Hívj meg új munkatársat linkkel vagy QR-kóddal'}</div>
          </div>
          <button className="btn sm auto" onClick={() => setExpanded(true)}>➕ Új meghívó</button>
        </div>
      </div>
    )
  }

  return (
    <div className="card stack">
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}>✉️ Meghívó küldése</div>
        <button className="btn ghost sm auto" onClick={() => setExpanded(false)}>Bezárás</button>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        A meghívottnak csak jelszót kell beállítania a linken — azonnal aktív tag lesz, nem kell jóváhagyni.
        A meghívó 7 napig érvényes és egyszer használható.
      </p>
      <div className="grid-2">
        <div className="field">
          <label>Név</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Kovács Béla" />
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="bela@email.hu" />
        </div>
      </div>
      <div className="field">
        <label>Szerep</label>
        <select className="select" value={role} onChange={(e) => setRole(e.target.value as Enums<'user_role'>)}>
          <option value="crew">{roleLabel.crew}</option>
          <option value="manager">{roleLabel.manager}</option>
          {isAdmin && <option value="admin">{roleLabel.admin}</option>}
        </select>
      </div>
      {error && <div className="alert error">{error}</div>}
      <button className="btn sm" disabled={create.isPending || !email.trim()} onClick={() => create.mutate()}>
        ➕ Meghívó létrehozása
      </button>

      {(invites?.length ?? 0) > 0 && <div className="divider" />}
      {invites?.map((inv) => {
        const st = stateOf(inv)
        return (
          <div key={inv.id} className="stack" style={{ gap: 6 }}>
            <div className="between">
              <div>
                <div className="small" style={{ fontWeight: 700 }}>{inv.full_name || inv.email}</div>
                <div className="tiny muted">{inv.email} · {roleLabel[inv.role]} · {formatDateTime(inv.created_at)}</div>
              </div>
              <span className={`badge ${st.cls}`}>{st.label}</span>
            </div>
            {!inv.used_at && (
              <div className="grid-3">
                <button className="btn secondary sm" onClick={() => void copyLink(inv.id)}>
                  {copiedId === inv.id ? '✔ Másolva' : '🔗 Link'}
                </button>
                <button className="btn secondary sm" onClick={() => void toggleQr(inv.id)}>
                  {qrFor === inv.id ? '✕ QR' : '📱 QR-kód'}
                </button>
                <button className="btn secondary sm" onClick={() => void shareLink(inv)}>📤 Megosztás</button>
              </div>
            )}
            {qrFor === inv.id && qrImg && (
              <div style={{ textAlign: 'center' }}>
                <img src={qrImg} alt="Meghívó QR" style={{ width: 220, maxWidth: '100%', borderRadius: 12, background: '#fff', padding: 8 }} />
                <div className="tiny muted">Olvastasd be a telefonjával — a linken csak jelszót kell megadnia.</div>
              </div>
            )}
            <ConfirmButton className="btn ghost sm auto" confirmLabel="Törlés" disabled={remove.isPending} onConfirm={() => remove.mutate(inv.id)}>
              🗑 Törlés
            </ConfirmButton>
            <div className="divider" />
          </div>
        )
      })}
    </div>
  )
}

export default function Members() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const qc = useQueryClient()
  const isAdmin = profile?.role === 'admin'

  const { data: members, isLoading } = useQuery({
    queryKey: ['members', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('workspace_id', currentWorkspaceId!)
        .neq('status', 'pending')
        .order('full_name')
      if (error) throw error
      return data as Profile[]
    },
  })

  const [actionError, setActionError] = useState<string | null>(null)

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Enums<'user_status'> }) => {
      const { error } = await supabase.rpc('set_user_status', { target_id: id, p_status: status })
      if (error) throw error
    },
    onSuccess: () => { setActionError(null); void qc.invalidateQueries({ queryKey: ['members'] }) },
    onError: (e) => setActionError('Az állapot mentése nem sikerült: ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })

  const setRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: Enums<'user_role'> }) => {
      const { error } = await supabase.rpc('approve_user', {
        target_id: id, p_role: role, p_workspace_id: currentWorkspaceId!,
      })
      if (error) throw error
    },
    onSuccess: () => { setActionError(null); void qc.invalidateQueries({ queryKey: ['members'] }) },
    onError: (e) => setActionError('A szerep mentése nem sikerült: ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })

  const roles: Enums<'user_role'>[] = isAdmin
    ? ['crew', 'manager', 'admin']
    : ['crew', 'manager']

  // Függőben lévő regisztrációk száma (link a Jóváhagyás oldalra)
  const { data: pendingCount } = useQuery({
    queryKey: ['members-pending-count', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      return count ?? 0
    },
  })

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'crew' | 'manager' | 'admin' | 'disabled'>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const effRole = (m: Profile): 'crew' | 'manager' | 'admin' =>
    m.role === 'manager' || m.role === 'admin' ? m.role : 'crew'

  const all = members ?? []
  const counts = {
    crew: all.filter((m) => effRole(m) === 'crew' && m.status === 'active').length,
    manager: all.filter((m) => effRole(m) === 'manager' && m.status === 'active').length,
    admin: all.filter((m) => effRole(m) === 'admin' && m.status === 'active').length,
    disabled: all.filter((m) => m.status !== 'active').length,
  }
  const q = norm(search.trim())
  const visible = all.filter((m) => {
    if (roleFilter === 'disabled' ? m.status === 'active' : roleFilter !== 'all' && (effRole(m) !== roleFilter || m.status !== 'active')) return false
    if (!q) return true
    return norm(m.full_name ?? '').includes(q) || norm(m.email ?? '').includes(q)
  })

  const initials = (m: Profile) => {
    const parts = (m.full_name || m.email || '?').trim().split(/\s+/)
    return (parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase()
  }
  const chip = (key: typeof roleFilter, label: string, n?: number) => (
    <button
      key={key}
      className={`badge ${roleFilter === key ? 'primary' : ''}`}
      style={{ cursor: 'pointer', border: roleFilter === key ? '1px solid var(--primary)' : undefined }}
      onClick={() => setRoleFilter(key)}
    >
      {label}{n != null ? ` · ${n}` : ''}
    </button>
  )

  return (
    <div className="stack">
      <div className="between">
        <h2>Tagok — {currentWorkspace?.name ?? ''}</h2>
        <span className="badge">{all.length} tag</span>
      </div>

      {(pendingCount ?? 0) > 0 && (
        <a href="/jovahagyas" className="alert info" style={{ textDecoration: 'none', display: 'block' }}>
          ⏳ {pendingCount} regisztráció vár jóváhagyásra → Jóváhagyás
        </a>
      )}

      <InviteCard />

      <div className="card stack" style={{ gap: 10 }}>
        <input
          className="input"
          placeholder="🔍 Keresés név vagy email alapján…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {chip('all', 'Mind', all.length)}
          {chip('crew', roleLabel.crew, counts.crew)}
          {chip('manager', roleLabel.manager, counts.manager)}
          {counts.admin > 0 && chip('admin', roleLabel.admin, counts.admin)}
          {counts.disabled > 0 && chip('disabled', 'Letiltott', counts.disabled)}
        </div>
      </div>

      {actionError && <div className="alert error">{actionError}</div>}
      {isLoading && <div className="card"><div className="spinner" /></div>}
      {!isLoading && all.length === 0 && (
        <div className="empty"><span className="ico">👥</span>Még nincs jóváhagyott tag ezen a munkaterületen.</div>
      )}
      {!isLoading && all.length > 0 && visible.length === 0 && (
        <div className="empty"><span className="ico">🔍</span>Nincs találat a szűrésre.</div>
      )}

      {visible.length > 0 && (
        <div className="card" style={{ padding: 6 }}>
          {visible.map((m) => {
            const isSelf = m.id === profile?.id
            const open = openId === m.id
            const role = effRole(m)
            const disabled = m.status !== 'active'
            return (
              <div key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : m.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px',
                    background: open ? 'var(--primary-ghost)' : 'transparent', border: 'none', color: 'inherit',
                    cursor: 'pointer', textAlign: 'left', borderRadius: 10, opacity: disabled ? 0.6 : 1,
                  }}
                >
                  <div
                    style={{
                      width: 38, height: 38, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                      fontWeight: 800, fontSize: 13,
                      background: role === 'admin' ? 'rgba(245,158,11,.18)' : role === 'manager' ? 'var(--primary-ghost)' : 'var(--bg-elev-2)',
                      color: role === 'admin' ? 'var(--warning)' : role === 'manager' ? 'var(--primary)' : 'var(--text)',
                    }}
                  >
                    {initials(m)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.full_name || m.email}{isSelf && <span className="tiny muted"> (te)</span>}
                    </div>
                    <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                  </div>
                  {role !== 'crew' && <span className={`badge ${role === 'admin' ? 'warning' : 'primary'}`}>{role === 'admin' ? 'Admin' : roleLabel[role]}</span>}
                  {disabled && <span className="badge danger">{statusLabel[m.status]}</span>}
                  <span className="muted" style={{ fontSize: 12, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }}>›</span>
                </button>
                {open && (
                  <div className="grid-2" style={{ padding: '4px 10px 12px' }}>
                    <div className="field">
                      <label>Szerep</label>
                      <select
                        className="select"
                        value={role}
                        disabled={isSelf || setRole.isPending}
                        onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value as Enums<'user_role'> })}
                      >
                        {roles.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                      </select>
                      {isSelf && <div className="tiny muted">A saját szerepedet nem módosíthatod.</div>}
                    </div>
                    <div className="field">
                      <label>Hozzáférés</label>
                      {m.status === 'active' ? (
                        <ConfirmButton className="btn danger sm" confirmLabel="Igen, letiltom" disabled={isSelf || setStatus.isPending}
                          onConfirm={() => setStatus.mutate({ id: m.id, status: 'disabled' })}>
                          🚫 Letiltás
                        </ConfirmButton>
                      ) : (
                        <button className="btn sm" disabled={setStatus.isPending}
                          onClick={() => setStatus.mutate({ id: m.id, status: 'active' })}>✅ Aktiválás</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
