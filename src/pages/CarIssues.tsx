import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { useCars } from '../hooks/useCars'
import { submitNow } from '../lib/outbox'
import { resolveNames } from '../lib/names'
import { carIssueStatusLabel, formatDateTime, isCrewRole } from '../lib/labels'
import PhotoSlot, { type CapturedPhoto } from '../components/PhotoSlot'
import PhotoThumb from '../components/PhotoThumb'
import type { Enums, Tables } from '../lib/database.types'

type Issue = Tables<'car_issues'>

export default function CarIssues() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const { data: today } = useToday()
  const qc = useQueryClient()
  const isCrew = isCrewRole(profile?.role)
  const isManagerOrAdmin = profile?.role === 'manager' || profile?.role === 'admin'

  const [carId, setCarId] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const { data: cars } = useCars()

  const { data: issues } = useQuery({
    queryKey: ['car-issues', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data } = await supabase
        .from('car_issues')
        .select('*, car:cars(plate)')
        .eq('workspace_id', currentWorkspaceId!)
        .order('created_at', { ascending: false })
        .limit(40)
      const rows = (data ?? []) as unknown as (Issue & { car: { plate: string } | null })[]
      const names = await resolveNames(rows.map((r) => r.user_id))
      return rows.map((r) => ({ ...r, _name: names[r.user_id] ?? null }))
    },
  })

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Enums<'car_issue_status'> }) => {
      const { error } = await supabase.from('car_issues').update({
        status,
        resolved_by: status === 'resolved' ? profile!.id : null,
        resolved_at: status === 'resolved' ? new Date().toISOString() : null,
      }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['car-issues'] }),
    onError: (e) => setMsg('Hiba: az állapot mentése nem sikerült — ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })

  // Alapértelmezett autó: amire ma be van csekkolva
  const effectiveCarId = carId || today?.car?.id || ''

  async function submit() {
    if (!currentWorkspaceId || !profile || !effectiveCarId || !note.trim()) return
    setBusy(true); setMsg(null)
    try {
      const id = crypto.randomUUID()
      await submitNow({
        id, table: 'car_issues', op: 'insert', label: 'Autó-hiba bejelentés',
        values: {
          id, workspace_id: currentWorkspaceId, car_id: effectiveCarId,
          user_id: profile.id, note: note.trim(),
        },
        ...(photo ? { photo: { workspaceId: currentWorkspaceId, folder: 'issues', id, column: 'photo_path', blob: photo.blob } } : {}),
      })
      setNote(''); setPhoto(null); setMsg('Hiba bejelentve. A menedzser látja és követi.')
      await qc.invalidateQueries({ queryKey: ['car-issues'] })
    } catch (e) {
      setMsg('Hiba: ' + (e instanceof Error ? e.message : 'ismeretlen'))
    } finally {
      setBusy(false)
    }
  }

  const statusBadge = (s: Enums<'car_issue_status'>) =>
    s === 'open' ? 'danger' : s === 'in_progress' ? 'warning' : 'success'

  return (
    <div className="stack">
      <h2>Autó-hibák — {currentWorkspace?.name}</h2>

      {isCrew && (
        <div className="card stack">
          <div className="card-title">Hiba bejelentése</div>
          <div className="field">
            <label>Autó</label>
            <select className="select" value={effectiveCarId} onChange={(e) => setCarId(e.target.value)}>
              <option value="">— válassz —</option>
              {cars?.map((c) => <option key={c.id} value={c.id}>{c.plate}{c.label ? ` (${c.label})` : ''}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Mi a probléma? *</label>
            <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="pl. bal első gumi ereszt, fék nyikorog…" />
          </div>
          <div style={{ maxWidth: 220 }}>
            <PhotoSlot label="Fotó (opcionális)" photo={photo} onCapture={setPhoto} />
          </div>
          {msg && <div className={`alert ${msg.startsWith('Hiba:') ? 'error' : 'success'}`}>{msg}</div>}
          <button className="btn" disabled={!effectiveCarId || !note.trim() || busy} onClick={() => void submit()}>
            {busy ? 'Mentés…' : '🔧 Bejelentés'}
          </button>
        </div>
      )}

      {(issues?.length ?? 0) === 0 && <div className="empty"><span className="ico">🔧</span>Nincs bejelentett hiba.</div>}

      {issues?.map((i) => (
        <div key={i.id} className="card stack">
          <div className="between">
            <div className="row" style={{ gap: 8 }}>
              <span className="badge primary">{i.car?.plate ?? '?'}</span>
              <span className={`badge ${statusBadge(i.status)}`}>{carIssueStatusLabel[i.status]}</span>
            </div>
            <span className="tiny muted">{formatDateTime(i.created_at)}</span>
          </div>
          <div className="small">{i.note}</div>
          <div className="tiny muted">Bejelentette: {i._name ?? 'Ismeretlen'}</div>
          {i.photo_path && <div style={{ maxWidth: 120 }}><PhotoThumb path={i.photo_path} /></div>}
          {isManagerOrAdmin && i.status !== 'resolved' && (
            <div className="btn-grid">
              {i.status === 'open' && (
                <button className="btn secondary sm" disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: i.id, status: 'in_progress' })}>▶ Folyamatban</button>
              )}
              <button className="btn sm" disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ id: i.id, status: 'resolved' })}>✔ Megoldva</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
