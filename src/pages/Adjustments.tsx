import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useMembers } from '../hooks/useMembers'
import { todayISO, formatDate, formatHuf, adjustmentTypeLabel, parseHuNumber } from '../lib/labels'
import type { Enums } from '../lib/database.types'

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
      const { data } = await supabase.from('adjustments')
        .select('*, user:profiles!adjustments_user_id_fkey(full_name)')
        .eq('workspace_id', currentWorkspaceId!)
        .order('work_date', { ascending: false }).limit(30)
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
      setAmount(''); setReason(''); setError(null)
      void qc.invalidateQueries({ queryKey: ['adjustments'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Hiba'),
  })

  const canSave = !!userId && !!amount && !add.isPending

  return (
    <div className="stack">
      <h2>Előleg / levonás — {currentWorkspace?.name}</h2>

      <div className="card stack">
        <div className="field">
          <label>Munkatárs</label>
          <select className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">— válassz —</option>
            {members?.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
          </select>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Típus</label>
            <select className="select" value={type} onChange={(e) => setType(e.target.value as Enums<'adjustment_type'>)}>
              <option value="advance">Előleg</option>
              <option value="deduction">Levonás</option>
            </select>
          </div>
          <div className="field">
            <label>Összeg (Ft)</label>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" />
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
        <button className="btn" disabled={!canSave} onClick={() => add.mutate()}>{add.isPending ? 'Mentés…' : 'Rögzítés'}</button>
      </div>

      {(list?.length ?? 0) > 0 && (
        <div className="card stack">
          <div className="card-title">Legutóbbi tételek</div>
          {list!.map((a) => (
            <div key={a.id} className="between">
              <div>
                <div className="small">{(a.user as unknown as { full_name: string | null } | null)?.full_name ?? 'Ismeretlen'}</div>
                <div className="tiny muted">{formatDate(a.work_date)}{a.reason ? ` · ${a.reason}` : ''}</div>
              </div>
              <span className={`badge ${a.type === 'advance' ? 'warning' : 'danger'}`}>
                {adjustmentTypeLabel[a.type]} {formatHuf(Number(a.amount))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
