import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useMembers } from '../hooks/useMembers'
import { todayISO, formatDate, formatHuf, adjustmentTypeLabel, parseHuNumber, isCrewRole } from '../lib/labels'
import { resolveNames } from '../lib/names'
import ConfirmButton from '../components/ConfirmButton'
import type { Enums } from '../lib/database.types'
import { toast } from '../lib/toast'
import Icon from '../components/Icon'

// Gyakori összegek egy koppintásra (készpénzes előleg)
const QUICK_AMOUNTS = [5000, 10000, 20000, 50000]

export default function Adjustments() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const qc = useQueryClient()
  const { data: members } = useMembers()

  const [userId, setUserId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<Enums<'adjustment_type'>>('advance')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  // A lista alapból a kiválasztott munkatársra szűr (előleg rögzítésekor
  // látszik, mennyit vett fel eddig a hónapban) — egy koppintással az összes
  const [showAll, setShowAll] = useState(false)

  // Csak munkatársnak van napidíjas bére — a vezetők nem kaphatnak előleget/levonást itt
  const crew = (members ?? []).filter((m) => isCrewRole(m.role))

  const { data: list } = useQuery({
    queryKey: ['adjustments', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('adjustments')
        .select('*, user:profiles!adjustments_user_id_fkey(full_name)')
        .eq('workspace_id', currentWorkspaceId!)
        .order('work_date', { ascending: false }).order('created_at', { ascending: false }).limit(60)
      if (error) throw error
      const rows = data ?? []
      // Ki rögzítette — a profiles-t a névfeloldó RPC-n át (csak nevek)
      const names = await resolveNames(rows.map((r) => r.created_by))
      return rows.map((r) => ({ ...r, _by: r.created_by ? names[r.created_by] ?? null : null }))
    },
  })

  // Téves tétel törlése (zárolt hónapban a trigger tiltja — a hibát mutatjuk)
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('adjustments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Tétel törölve.'); void qc.invalidateQueries({ queryKey: ['adjustments'] }) },
    onError: (e) => toast.error('Nem törölhető: ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })

  const add = useMutation({
    mutationFn: async () => {
      const amt = parseHuNumber(amount)
      // Negatív előleg/levonás fordítva hatna a bérre — csak pozitív összeg mehet
      if (!Number.isFinite(amt) || amt <= 0) throw new Error('Érvénytelen összeg — pozitív számot adj meg.')
      const { error } = await supabase.from('adjustments').insert({
        workspace_id: currentWorkspaceId!, user_id: userId, work_date: date,
        amount: amt,
        type, reason: reason.trim() || null, created_by: profile!.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      const who = members?.find((m) => m.id === userId)
      toast.success(`${type === 'advance' ? 'Előleg' : 'Levonás'} rögzítve${who ? ` — ${who.full_name || who.email}` : ''}`)
      setAmount(''); setReason(''); setError(null)
      void qc.invalidateQueries({ queryKey: ['adjustments'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Hiba'),
  })

  const canSave = !!userId && !!amount && !add.isPending

  return (
    <div className="stack">
      <h2>Előleg / levonás — {currentWorkspace?.name}</h2>

      <div className="card stack primary">
        <div className="card-title" style={{ margin: 0 }}><Icon name="wallet" />Új tétel</div>
        <div className="field">
          <label>Munkatárs</label>
          <select className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">— válassz —</option>
            {crew.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Típus</label>
          {/* Két választás → kapcsoló, nem legördülő (egy koppintás, látszik mindkettő) */}
          <div className="tabs" style={{ margin: 0 }}>
            <button type="button" className={type === 'advance' ? 'active' : ''} onClick={() => setType('advance')}><Icon name="banknote" size={18} />Előleg</button>
            <button type="button" className={type === 'deduction' ? 'active' : ''} onClick={() => setType('deduction')}><Icon name="minus" size={18} />Levonás</button>
          </div>
          <div className="tiny muted">
            {type === 'advance'
              ? 'Előleg: a hónap közben felvett pénz — a bérlapon nem látszik, a kifizetéskor számolódik el.'
              : 'Levonás: a bérből levont összeg (pl. kár) — a bérlapon indokkal szerepel.'}
          </div>
        </div>
        <div className="field">
          <label>Összeg (Ft)</label>
          <input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10 000" />
          <div className="chips">
            {QUICK_AMOUNTS.map((q) => (
              <button key={q} type="button" className="chip" style={{ minHeight: 34, padding: '4px 10px' }} onClick={() => setAmount(String(q))}>
                {formatHuf(q)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Dátum</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Indok</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="pl. előleg készpénzben" />
        </div>
        {error && <div className="alert error">{error}</div>}
        {/* Bért érintő művelet — két koppintás, mint a többi véglegesítésnél */}
        <ConfirmButton className="btn" confirmLabel={`Biztos? ${type === 'advance' ? 'Előleg' : 'Levonás'} rögzítése`} disabled={!canSave} onConfirm={() => add.mutate()}>
          <Icon name="check" />{add.isPending ? 'Mentés…' : 'Rögzítés'}
        </ConfirmButton>
      </div>

      {(() => {
        const all = list ?? []
        const selected = userId && !showAll ? crew.find((m) => m.id === userId) : null
        const shown = selected ? all.filter((a) => a.user_id === userId) : all
        // A kiválasztott munkatárs e havi előlege — rögzítés előtt jó látni
        const ym = todayISO().slice(0, 7)
        const monthAdv = selected ? shown.filter((a) => a.type === 'advance' && a.work_date.startsWith(ym)).reduce((x, a) => x + Number(a.amount), 0) : 0
        if (all.length === 0) return null
        return (
          <div className="card stack">
            <div className="between">
              <div className="card-title" style={{ margin: 0 }}><Icon name="history" />{selected ? 'Tételei' : 'Legutóbbi tételek'}</div>
              {userId && (
                <button className="link-btn" type="button" style={{ width: 'auto', fontSize: 13, padding: '6px 8px' }} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Csak a kiválasztott' : 'Összes munkatárs'}
                </button>
              )}
            </div>
            {selected && (
              <div className="tiny muted">
                {selected.full_name || selected.email} · ebben a hónapban felvett előleg: <strong>{formatHuf(monthAdv)}</strong>
              </div>
            )}
            {shown.length === 0 && <div className="tiny muted">Nincs rögzített tétel ennél a munkatársnál.</div>}
            {shown.map((a) => (
              <div key={a.id} className="between" style={{ gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 600 }}>{(a.user as unknown as { full_name: string | null } | null)?.full_name ?? 'Ismeretlen'}</div>
                  <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatDate(a.work_date)}{a.reason ? ` · ${a.reason}` : ''}{a._by ? ` · ${a._by}` : ''}
                  </div>
                </div>
                <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                  <span className={`badge ${a.type === 'advance' ? 'money' : 'danger'}`}>
                    {a.type === 'deduction' ? '−' : ''}{formatHuf(Number(a.amount))}
                    <span className="muted" style={{ fontWeight: 500 }}>{adjustmentTypeLabel[a.type].toLowerCase()}</span>
                  </span>
                  <ConfirmButton className="btn ghost sm" confirmLabel="Törlés?" title="Tétel törlése" disabled={remove.isPending}
                    style={{ minHeight: 34, padding: '4px 8px' }}
                    onConfirm={() => remove.mutate(a.id)}>
                    <Icon name="trash" size={16} />
                  </ConfirmButton>
                </div>
              </div>
            ))}
          </div>
        )
      })()}
    </div>
  )
}
