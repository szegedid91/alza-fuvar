import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useMembers } from '../hooks/useMembers'
import { todayISO, formatDate, formatHuf, adjustmentTypeLabel, parseHuNumber } from '../lib/labels'
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

  const { data: list } = useQuery({
    queryKey: ['adjustments', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('adjustments')
        .select('*, user:profiles!adjustments_user_id_fkey(full_name)')
        .eq('workspace_id', currentWorkspaceId!)
        .order('work_date', { ascending: false }).limit(30)
      if (error) throw error
      return data ?? []
    },
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
            {members?.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
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
        <button className="btn" disabled={!canSave} onClick={() => add.mutate()}><Icon name="check" />{add.isPending ? 'Mentés…' : 'Rögzítés'}</button>
      </div>

      {(list?.length ?? 0) > 0 && (
        <div className="card stack">
          <div className="card-title"><Icon name="history" />Legutóbbi tételek</div>
          {list!.map((a) => (
            <div key={a.id} className="between" style={{ gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div className="small" style={{ fontWeight: 600 }}>{(a.user as unknown as { full_name: string | null } | null)?.full_name ?? 'Ismeretlen'}</div>
                <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatDate(a.work_date)}{a.reason ? ` · ${a.reason}` : ''}</div>
              </div>
              <span className={`badge ${a.type === 'advance' ? 'money' : 'danger'}`} style={{ flexShrink: 0 }}>
                {a.type === 'deduction' ? '−' : ''}{formatHuf(Number(a.amount))}
                <span className="muted" style={{ fontWeight: 500 }}>{adjustmentTypeLabel[a.type].toLowerCase()}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
