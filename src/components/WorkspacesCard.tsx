import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { COMPANY_NAME } from '../lib/brand'
import { toast } from '../lib/toast'
import { errMsg } from '../lib/errors'
import Icon from './Icon'

// Területek (munkaterületek) kezelése — csak admin. Az app az Utód Zrt.-é, a területek a megbízók
// (pl. Alza); egy új terület saját tagokkal, autókkal, járatokkal, napidíjakkal és raktárral jön létre,
// a fejlécben a területváltóval lehet köztük lépni.
export default function WorkspacesCard() {
  const { workspaces, currentWorkspaceId, setCurrentWorkspaceId, reload } = useWorkspace()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Tagok száma területenként (aktív + meghívott) — az admin minden profilt lát
  const { data: counts } = useQuery({
    queryKey: ['ws-counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('workspace_id, status').in('status', ['active', 'invited'])
      if (error) throw error
      const out: Record<string, { active: number; invited: number }> = {}
      for (const p of data ?? []) {
        if (!p.workspace_id) continue
        out[p.workspace_id] ??= { active: 0, invited: 0 }
        out[p.workspace_id][p.status === 'active' ? 'active' : 'invited']++
      }
      return out
    },
  })

  const invalidate = () => { void reload(); void qc.invalidateQueries({ queryKey: ['ws-counts'] }) }
  const create = useMutation({
    mutationFn: async () => {
      const n = name.trim()
      if (n.length < 2) throw new Error('Adj meg egy nevet (legalább 2 karakter).')
      if (workspaces.some((w) => w.name.trim().toLowerCase() === n.toLowerCase())) throw new Error('Már van ilyen nevű terület.')
      const { data, error } = await supabase.from('workspaces').insert({ name: n }).select('id').single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: (id) => {
      setError(null); setName('')
      toast.success('Új terület létrehozva — a fejlécben a területváltóval tudsz rá váltani.')
      invalidate()
      setCurrentWorkspaceId(id)
    },
    onError: (e) => setError(errMsg(e, 'A terület létrehozása nem sikerült')),
  })
  const rename = useMutation({
    mutationFn: async ({ id, name: n }: { id: string; name: string }) => {
      if (n.trim().length < 2) throw new Error('Adj meg egy nevet (legalább 2 karakter).')
      const { error } = await supabase.from('workspaces').update({ name: n.trim() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { setError(null); setEditing(null); toast.success('A terület átnevezve.'); invalidate() },
    onError: (e) => setError(errMsg(e, 'Az átnevezés nem sikerült')),
  })

  if (!open) {
    return (
      <div className="card">
        <div className="between">
          <div>
            <div className="card-title" style={{ margin: 0 }}><Icon name="warehouse" />Területek</div>
            <div className="tiny muted">{COMPANY_NAME} · {workspaces.length} terület: {workspaces.map((w) => w.name).join(', ')}</div>
          </div>
          <button className="btn secondary sm auto" style={{ whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => setOpen(true)}>Kezelés</button>
        </div>
      </div>
    )
  }

  return (
    <div className="card stack">
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}><Icon name="warehouse" />Területek — {COMPANY_NAME}</div>
        <button className="btn ghost sm auto" onClick={() => { setOpen(false); setEditing(null); setError(null) }}>Bezárás</button>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        Egy terület egy megbízó (pl. Alza): saját tagok, autók, járatok, napidíjak és raktár tartoznak hozzá.
        A fejlécben a területváltóval lépsz közöttük; a menedzsereket a Tagoknál rendeled a területekhez.
      </p>
      {workspaces.map((w) => {
        const c = counts?.[w.id]
        const isEditing = editing?.id === w.id
        return (
          <div key={w.id} className="between" style={{ gap: 8 }}>
            {isEditing ? (
              <input className="input" value={editing.name} autoFocus onChange={(e) => setEditing({ id: w.id, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') rename.mutate(editing) ; if (e.key === 'Escape') setEditing(null) }} />
            ) : (
              <div style={{ minWidth: 0 }}>
                <div className="small" style={{ fontWeight: 700 }}>
                  {w.name}{w.id === currentWorkspaceId && <span className="badge primary" style={{ marginLeft: 6 }}>kiválasztva</span>}
                </div>
                <div className="tiny muted">{c ? `${c.active} aktív tag${c.invited ? ` · ${c.invited} meghívott` : ''}` : 'még nincs tag'}</div>
              </div>
            )}
            <div className="row" style={{ gap: 4, flexShrink: 0 }}>
              {isEditing ? (
                <>
                  <button className="btn sm auto" disabled={rename.isPending} onClick={() => rename.mutate(editing)}><Icon name="check" size={16} /></button>
                  <button className="btn ghost sm auto" onClick={() => setEditing(null)}><Icon name="x" size={16} /></button>
                </>
              ) : (
                <>
                  {w.id !== currentWorkspaceId && <button className="btn ghost sm auto" onClick={() => setCurrentWorkspaceId(w.id)}>Váltás</button>}
                  <button className="btn ghost sm auto" aria-label="Átnevezés" title="Átnevezés" onClick={() => { setEditing({ id: w.id, name: w.name }); setError(null) }}><Icon name="pencil" size={16} /></button>
                </>
              )}
            </div>
          </div>
        )
      })}
      <div className="divider" />
      <div className="field">
        <label>Új terület neve</label>
        <div className="row" style={{ gap: 6 }}>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="pl. Spar" style={{ flex: 1, minWidth: 0 }}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) create.mutate() }} />
          <button className="btn sm auto" disabled={create.isPending || name.trim().length < 2} style={{ whiteSpace: 'nowrap' }} onClick={() => create.mutate()}>
            <Icon name="plus" />{create.isPending ? 'Létrehozás…' : 'Létrehozás'}
          </button>
        </div>
        <div className="tiny muted">Létrehozás után állítsd be a napidíjakat a Bér oldalon, a raktárt és a járatokat a Járatok oldalon, és vedd fel az autókat.</div>
      </div>
      {error && <div className="alert error">{error}</div>}
    </div>
  )
}
