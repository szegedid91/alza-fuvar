import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import type { Enums, Tables } from '../lib/database.types'
import { roleLabel, statusLabel, formatDateTime, formatDate } from '../lib/labels'
import { qrDataUrl } from '../lib/qr'
import { telHref } from '../lib/names'
import ConfirmButton from '../components/ConfirmButton'
import Icon from '../components/Icon'

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
  const [showLinkFor, setShowLinkFor] = useState<string | null>(null)
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

  // A meghívóval együtt helyőrző fiók is létrejön (manage-invite): a munkatárs
  // azonnal beosztható, a regisztrációkor ugyanez a fiók aktiválódik
  const invokeInvite = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('manage-invite', { body })
    if (error) {
      let msg = 'A művelet nem sikerült'
      let needsConfirm: { shifts: number; first: string; last: string } | null = null
      try {
        const b = await (error as { context?: Response }).context?.json()
        if (b?.error) msg = b.error
        if (b?.needs_confirm) needsConfirm = { shifts: b.shifts, first: b.first, last: b.last }
      } catch { /* marad az általános */ }
      const err = new Error(msg) as Error & { needsConfirm?: typeof needsConfirm }
      err.needsConfirm = needsConfirm
      throw err
    }
    if (data?.error) throw new Error(data.error)
    return data
  }
  // Helyőrző törlése, aki már szerepel a beosztásban: a szerver 409-cel jelez, itt megerősítést kérünk
  const [inviteWarn, setInviteWarn] = useState<{ id: string; name: string; shifts: number; first: string; last: string } | null>(null)
  const create = useMutation({
    mutationFn: async () => {
      const em = email.trim().toLowerCase()
      if (!name.trim()) throw new Error('A név kötelező (ezzel kerül a beosztásba).')
      if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw new Error('Érvénytelen email-cím.')
      await invokeInvite({ action: 'create', workspace_id: currentWorkspaceId, full_name: name.trim(), email: em || null, role })
    },
    onSuccess: () => {
      setError(null); setName(''); setEmail(''); setRole('crew')
      void qc.invalidateQueries({ queryKey: ['invites'] })
      void qc.invalidateQueries({ queryKey: ['ws-members'] })
      void qc.invalidateQueries({ queryKey: ['members'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'A meghívó létrehozása nem sikerült'),
  })

  const remove = useMutation({
    mutationFn: async ({ id, force = false }: { id: string; force?: boolean }) => {
      try { await invokeInvite({ action: 'delete', invite_id: id, force }) }
      catch (e) {
        const nc = (e as Error & { needsConfirm?: { shifts: number; first: string; last: string } | null }).needsConfirm
        if (nc) { const inv = (invites ?? []).find((i) => i.id === id); setInviteWarn({ id, name: inv?.full_name || inv?.email || 'A munkatárs', ...nc }); return }
        throw e
      }
      setInviteWarn(null)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invites'] })
      void qc.invalidateQueries({ queryKey: ['ws-members'] })
      void qc.invalidateQueries({ queryKey: ['members'] })
      void qc.invalidateQueries({ queryKey: ['shifts'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'A törlés nem sikerült'),
  })

  const linkOf = (id: string) => `${window.location.origin}/meghivo/${id}`

  async function copyLink(id: string) {
    try {
      await navigator.clipboard.writeText(linkOf(id))
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      // iOS PWA-ban a window.prompt néma — mutassuk a linket a kártyán
      setShowLinkFor(id)
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
            <div className="card-title" style={{ margin: 0 }}><Icon name="send" />Meghívók</div>
            <div className="tiny muted">{activeCount > 0 ? `${activeCount} aktív meghívó` : 'Hívj meg új munkatársat linkkel vagy QR-kóddal'}</div>
          </div>
          <button className="btn sm auto" style={{ whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => setExpanded(true)}><Icon name="plus" />Új meghívó</button>
        </div>
      </div>
    )
  }

  return (
    <div className="card stack">
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}><Icon name="send" />Meghívó küldése</div>
        <button className="btn ghost sm auto" onClick={() => setExpanded(false)}>Bezárás</button>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        A meghívott <strong>azonnal beosztható</strong> (a Beosztásban név szerint megjelenik), a linken csak jelszót kell beállítania —
        aktív tag lesz, a már beírt beosztásai megmaradnak. Email nélkül is felvehető: akkor a regisztrációkor adja meg.
        A meghívó 7 napig érvényes és egyszer használható.
      </p>
      <div className="grid-2">
        <div className="field">
          <label>Név</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Kovács Béla" />
        </div>
        <div className="field">
          <label>Email (nem kötelező)</label>
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
      <button className="btn sm" disabled={create.isPending || !name.trim()} onClick={() => create.mutate()}>
        <Icon name="plus" />{create.isPending ? 'Létrehozás…' : 'Munkatárs felvétele + meghívó'}
      </button>

      {(invites?.length ?? 0) > 0 && <div className="divider" />}
      {invites?.map((inv) => {
        const st = stateOf(inv)
        return (
          <div key={inv.id} className="stack" style={{ gap: 6 }}>
            <div className="between">
              <div>
                <div className="small" style={{ fontWeight: 700 }}>{inv.full_name || inv.email}</div>
                <div className="tiny muted">{inv.email ?? 'email nélkül'} · {roleLabel[inv.role]} · {formatDateTime(inv.created_at)}</div>
              </div>
              <span className="row" style={{ gap: 4, flexShrink: 0 }}>
                {!inv.used_at && inv.placeholder_id && <span className="badge" title="Már beosztható a Beosztásban"><Icon name="calendar" />beosztható</span>}
                <span className={`badge ${st.cls}`}>{st.label}</span>
              </span>
            </div>
            {!inv.used_at && (
              <div className="grid-3">
                <button className="btn secondary sm" onClick={() => void copyLink(inv.id)}>
                  {copiedId === inv.id ? <><Icon name="check" />Másolva</> : 'Link'}
                </button>
                <button className="btn secondary sm" onClick={() => void toggleQr(inv.id)}>
                  {/* rövid felirat: a 3 oszlopos rács telefonon két sorba törné a "QR-kód"-ot */}
                  {qrFor === inv.id ? <><Icon name="x" />QR</> : <><Icon name="qr-code" />QR</>}
                </button>
                <button className="btn secondary sm" onClick={() => void shareLink(inv)}><Icon name="upload" />Megosztás</button>
              </div>
            )}
            {showLinkFor === inv.id && (
              <div className="tiny" style={{ wordBreak: 'break-all', userSelect: 'all', background: 'var(--bg)', borderRadius: 8, padding: 8 }}>
                {linkOf(inv.id)}
              </div>
            )}
            {qrFor === inv.id && qrImg && (
              <div style={{ textAlign: 'center' }}>
                <img src={qrImg} alt="Meghívó QR" style={{ width: 220, maxWidth: '100%', borderRadius: 12, background: '#fff', padding: 8 }} />
                <div className="tiny muted">Olvastasd be a telefonjával — a linken csak jelszót kell megadnia.</div>
              </div>
            )}
            <ConfirmButton className="btn ghost sm auto" confirmLabel="Törlés" disabled={remove.isPending} onConfirm={() => remove.mutate({ id: inv.id })}>
              Törlés
            </ConfirmButton>
            {inviteWarn?.id === inv.id && (
              <div className="card stack" style={{ borderColor: 'var(--danger)', gap: 6 }}>
                <div className="card-title" style={{ color: 'var(--danger)', margin: 0 }}><Icon name="alert-triangle" />{inviteWarn.name} már szerepel a beosztásban</div>
                <p className="small" style={{ margin: 0 }}>
                  <strong>{inviteWarn.shifts} napon</strong> van beosztva ({formatDate(inviteWarn.first)} – {formatDate(inviteWarn.last)}). Ha törlöd, ezekből a napokból kikerül, és a bérszámításban sem jelenik meg. Ha a munkatárs mégis dolgozik, inkább hagyd meg a meghívót.
                </p>
                <div className="btn-grid">
                  <button type="button" className="btn secondary sm" onClick={() => setInviteWarn(null)}>Mégse, marad</button>
                  <ConfirmButton className="btn danger sm" confirmLabel="Igen, törlés a beosztásból is" disabled={remove.isPending} onConfirm={() => remove.mutate({ id: inv.id, force: true })}>
                    <Icon name="trash" />Törlés mindenhonnan
                  </ConfirmButton>
                </div>
              </div>
            )}
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

  // Tag törlése. A szerver alapból MEGTAGADJA, ha munka-/bér-adat tartozik hozzá
  // (ADATOS_TAG hiba) — ilyenkor megmutatjuk, mi veszne el, és a felhasználó
  // dönthet a végleges törlésről vagy a letiltásról.
  const [deleteWarn, setDeleteWarn] = useState<{ id: string; name: string; details: string } | null>(null)

  const removeMember = useMutation({
    mutationFn: async ({ id, force }: { id: string; force: boolean }) => {
      const { error } = await supabase.rpc('delete_member', { target_id: id, p_force: force })
      if (error) throw error
    },
    onSuccess: () => {
      setActionError(null); setDeleteWarn(null)
      void qc.invalidateQueries({ queryKey: ['members'] })
      void qc.invalidateQueries({ queryKey: ['ws-members'] })
    },
    onError: (e, vars) => {
      const msg = e instanceof Error ? e.message : 'ismeretlen hiba'
      const m = msg.match(/ADATOS_TAG:\s*(.*)$/)
      if (m) {
        const who = (members ?? []).find((x) => x.id === vars.id)
        setDeleteWarn({ id: vars.id, name: who?.full_name || who?.email || 'a munkatárs', details: m[1] })
        setActionError(null)
      } else {
        setDeleteWarn(null)
        setActionError('A törlés nem sikerült: ' + msg)
      }
    },
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
  const [roleFilter, setRoleFilter] = useState<'all' | 'crew' | 'manager' | 'admin' | 'disabled' | 'registered' | 'invited'>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const effRole = (m: Profile): 'crew' | 'manager' | 'admin' =>
    m.role === 'manager' || m.role === 'admin' ? m.role : 'crew'

  const all = members ?? []
  const counts = {
    crew: all.filter((m) => effRole(m) === 'crew' && m.status === 'active').length,
    manager: all.filter((m) => effRole(m) === 'manager' && m.status === 'active').length,
    admin: all.filter((m) => effRole(m) === 'admin' && m.status === 'active').length,
    disabled: all.filter((m) => m.status === 'disabled').length,
    // Regisztrált = van jelszava, be tud lépni; meghívott = helyőrző, még nem váltotta be a meghívót
    registered: all.filter((m) => m.status === 'active').length,
    invited: all.filter((m) => m.status === 'invited').length,
  }
  const q = norm(search.trim())
  const visible = all.filter((m) => {
    if (roleFilter === 'registered') { if (m.status !== 'active') return false }
    else if (roleFilter === 'invited') { if (m.status !== 'invited') return false }
    else if (roleFilter === 'disabled' ? m.status !== 'disabled' : roleFilter !== 'all' && (effRole(m) !== roleFilter || m.status !== 'active')) return false
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

      {(pendingCount ?? 0) > 0 && (
        <Link to="/jovahagyas" className="alert info row" style={{ textDecoration: 'none', gap: 8, justifyContent: 'space-between' }}>
          <span><Icon name="user-check" size={16} style={{ verticalAlign: -3 }} /> {pendingCount} regisztráció vár jóváhagyásra</span>
          <Icon name="chevron-right" size={16} />
        </Link>
      )}

      <InviteCard />

      <div className="card stack" style={{ gap: 10 }}>
        <div className="between">
          <div className="card-title" style={{ margin: 0 }}><Icon name="users" />{currentWorkspace?.name ?? 'Tagok'}</div>
          <span className="badge">{all.length} tag</span>
        </div>
        <div className="input-icon">
          <Icon name="search" size={18} />
          <input
            className="input"
            placeholder="Keresés név vagy email alapján…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {chip('all', 'Mind', all.length)}
          {chip('crew', roleLabel.crew, counts.crew)}
          {chip('manager', roleLabel.manager, counts.manager)}
          {counts.admin > 0 && chip('admin', roleLabel.admin, counts.admin)}
          {counts.disabled > 0 && chip('disabled', 'Letiltott', counts.disabled)}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="tiny muted">Regisztráció:</span>
          {chip('registered', 'Regisztrált', counts.registered)}
          {chip('invited', 'Még nem regisztrált', counts.invited)}
        </div>
      </div>

      {actionError && <div className="alert error">{actionError}</div>}

      {deleteWarn && (
        <div className="card stack" style={{ borderColor: 'var(--danger)' }}>
          <div className="card-title" style={{ color: 'var(--danger)', margin: 0 }}>
            <Icon name="alert-triangle" />{deleteWarn.name} törlése adatvesztéssel jár
          </div>
          <p className="small" style={{ margin: 0 }}>
            Hozzá tartozik: <strong>{deleteWarn.details}</strong>. A végleges törlés ezeket is
            eltávolítja — a korábbi bérszámítás és az előzmények módosulnak. Ha csak azt szeretnéd,
            hogy ne tudjon belépni, válaszd a <strong>Letiltást</strong>: az adatok megmaradnak.
          </p>
          <div className="btn-grid">
            <button className="btn secondary sm" onClick={() => setDeleteWarn(null)}>Mégse</button>
            <button
              className="btn sm"
              disabled={setStatus.isPending}
              onClick={() => { setStatus.mutate({ id: deleteWarn.id, status: 'disabled' }); setDeleteWarn(null) }}
            >
              <Icon name="ban" />Inkább letiltom
            </button>
          </div>
          <ConfirmButton
            className="btn danger sm"
            confirmLabel="Igen, törlés az adatokkal együtt"
            disabled={removeMember.isPending}
            onConfirm={() => removeMember.mutate({ id: deleteWarn.id, force: true })}
          >
            <Icon name="trash" />Végleges törlés az adataival együtt
          </ConfirmButton>
        </div>
      )}
      {isLoading && <div className="card"><div className="spinner" /></div>}
      {!isLoading && all.length === 0 && (
        <div className="empty"><span className="ico"><Icon name="users" size={40} /></span>Még nincs jóváhagyott tag ezen a munkaterületen.</div>
      )}
      {!isLoading && all.length > 0 && visible.length === 0 && (
        <div className="empty"><span className="ico"><Icon name="search" size={40} /></span>Nincs találat a szűrésre.</div>
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
                  {m.status === 'active' && <span className="badge success" title="Beváltotta a meghívót, be tud lépni"><Icon name="check" size={12} />regisztrált</span>}
                  {disabled && <span className={`badge ${m.status === 'invited' ? 'warning' : 'danger'}`}>{m.status === 'invited' ? 'még nem regisztrált' : statusLabel[m.status]}</span>}
                  <Icon name="chevron-right" size={18} className="muted" style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
                </button>
                {open && (
                  <div className="grid-2" style={{ padding: '4px 10px 12px' }}>
                    {/* Telefon — egy koppintással hívható (párosok szervezésénél, hiányzásnál) */}
                    <div className="field" style={{ gridColumn: '1 / -1' }}>
                      <label>Telefon</label>
                      {m.phone
                        ? (telHref(m.phone)
                          ? <a className="small row" href={telHref(m.phone)!} style={{ gap: 6, textDecoration: 'none' }}><Icon name="phone" size={16} />{m.phone}</a>
                          : <div className="small">{m.phone}</div>)
                        : <div className="tiny muted">Nincs megadva — a munkatárs a Profil oldalán adhatja meg.</div>}
                    </div>
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
                        <ConfirmButton className="btn secondary sm" confirmLabel="Igen, letiltom" disabled={isSelf || setStatus.isPending}
                          onConfirm={() => setStatus.mutate({ id: m.id, status: 'disabled' })}>
                          <Icon name="ban" />Letiltás
                        </ConfirmButton>
                      ) : m.status === 'invited' ? (
                        <div className="tiny muted">Előre felvett munkatárs — a meghívó linkjén regisztrál, akkor lesz aktív. A meghívó a Meghívók kártyán törölhető.</div>
                      ) : (
                        <button className="btn sm" disabled={setStatus.isPending}
                          onClick={() => setStatus.mutate({ id: m.id, status: 'active' })}><Icon name="check" />Aktiválás</button>
                      )}
                    </div>
                    {/* Törlés: admin bárkit, menedzser csak munkatársat (a szerver is ellenőrzi) */}
                    {!isSelf && (isAdmin || role === 'crew') && (
                      <div className="field" style={{ gridColumn: '1 / -1' }}>
                        <label>Végleges törlés</label>
                        <ConfirmButton
                          className="btn danger-outline sm"
                          confirmLabel="Igen, törlöm a tagot"
                          disabled={removeMember.isPending}
                          onConfirm={() => removeMember.mutate({ id: m.id, force: false })}
                        >
                          Tag törlése
                        </ConfirmButton>
                        <div className="tiny muted">
                          A fiók megszűnik, a munkatárs nem tud belépni. Ha van hozzá munka- vagy
                          bér-adat, előbb figyelmeztetést kapsz.
                        </div>
                      </div>
                    )}
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
