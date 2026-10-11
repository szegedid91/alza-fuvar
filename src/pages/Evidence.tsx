import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PhotoSlot, { type CapturedPhoto } from '../components/PhotoSlot'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { supabase } from '../lib/supabase'
import { submitNow } from '../lib/outbox'
import { evidenceCategoryLabel, formatDateTime, todayISO, parseHuNumber } from '../lib/labels'
import type { Enums } from '../lib/database.types'
import PhotoThumb from '../components/PhotoThumb'
import { toast } from '../lib/toast'
import { useMembers } from '../hooks/useMembers'
import { useCars } from '../hooks/useCars'
import { useCarCategories } from '../hooks/useCarCategories'
import { groupByCategory } from '../lib/calendar'
import Icon from '../components/Icon'

const CATS: Enums<'evidence_category'>[] = ['dirt', 'damage', 'cigarette_burn', 'other']

function DeductionFromEvidence({ evidenceId, categoryLabel }: { evidenceId: string; categoryLabel: string }) {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const { data: members } = useMembers()
  const [open, setOpen] = useState(false)
  const [userId, setUserId] = useState('')
  const [amount, setAmount] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!currentWorkspaceId || !profile || !userId || !amount) return
    const amt = parseHuNumber(amount)
    // Negatív "levonás" növelné a fizetést — csak pozitív összeg mehet
    if (!Number.isFinite(amt) || amt <= 0) { setError('Érvénytelen összeg — pozitív számot adj meg.'); return }
    setBusy(true)
    setError(null)
    const { error: insErr } = await supabase.from('adjustments').insert({
      workspace_id: currentWorkspaceId, user_id: userId, work_date: todayISO(),
      amount: amt, type: 'deduction',
      reason: `Bizonyíték-fotó: ${categoryLabel}`, evidence_id: evidenceId, created_by: profile.id,
    })
    setBusy(false)
    // A hiba NEM tűnhet el némán (pl. zárolt hónap trigger-hibája)
    if (insErr) { setError('Levonás sikertelen: ' + insErr.message); return }
    setDone(true); setOpen(false)
  }

  if (done) return <div className="badge success" style={{ marginTop: 6 }}><Icon name="check" />Levonás létrehozva</div>
  if (!open) return <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setOpen(true)}><Icon name="minus" />Levonás a bérből</button>
  return (
    <div className="stack" style={{ marginTop: 8 }}>
      <select className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
        <option value="">— kire —</option>
        {members?.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
      </select>
      <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Összeg (Ft)" />
      {error && <div className="alert error">{error}</div>}
      <div className="btn-grid">
        <button className="btn ghost sm" onClick={() => setOpen(false)}>Mégse</button>
        <button className="btn sm" disabled={busy || !userId || !amount} onClick={() => void create()}>Levonás</button>
      </div>
    </div>
  )
}

export default function Evidence() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const qc = useQueryClient()
  const [carId, setCarId] = useState('')
  const [category, setCategory] = useState<Enums<'evidence_category'>>('dirt')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const { data: cars } = useCars()
  const { data: categories } = useCarCategories()

  const { data: list } = useQuery({
    queryKey: ['evidence', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('evidence_photos')
        .select('*, car:cars(plate)').eq('workspace_id', currentWorkspaceId!)
        .order('created_at', { ascending: false }).limit(20)
      if (error) throw error
      return data ?? []
    },
  })

  async function submit() {
    if (!currentWorkspaceId || !profile || !photo) return
    setBusy(true); setMsg(null)
    try {
      const id = crypto.randomUUID()
      await submitNow({
        id, table: 'evidence_photos', op: 'insert', label: 'Bizonyíték-fotó',
        values: {
          id, workspace_id: currentWorkspaceId, car_id: carId || null, category,
          note: note.trim() || null, created_by: profile.id,
        },
        photo: { workspaceId: currentWorkspaceId, folder: 'evidence', id, column: 'photo_path', blob: photo.blob },
      })
      setPhoto(null); setNote(''); toast.success('Bizonyíték-fotó elmentve.')
      await qc.invalidateQueries({ queryKey: ['evidence'] })
    } catch (e) {
      setMsg('Hiba: ' + (e instanceof Error ? e.message : 'ismeretlen'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <h2>Bizonyíték-fotók — {currentWorkspace?.name}</h2>
      <div className="card stack primary">
        <div className="card-title" style={{ margin: 0 }}><Icon name="camera" />Új bizonyíték</div>
        <p className="tiny muted" style={{ margin: 0 }}>
          Kosz, törés vagy más kár dokumentálása élő fotóval — a fotóból utána egy koppintással levonás készíthető.
        </p>
        <div className="field">
          <label>Autó</label>
          <select className="select" value={carId} onChange={(e) => setCarId(e.target.value)}>
            <option value="">— nincs kiválasztva —</option>
            {groupByCategory(cars ?? [], categories).map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.cars.map((c) => <option key={c.id} value={c.id}>{c.plate}{c.label ? ` · ${c.label}` : ''}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Kategória</label>
          {/* 4 választás → chipek, nem legördülő: egy koppintás, látszik mind */}
          <div className="chips">
            {CATS.map((c) => (
              <button key={c} type="button" className={`badge ${category === c ? 'primary' : ''}`}
                style={{ cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700, minHeight: 36, padding: '6px 12px' }}
                onClick={() => setCategory(c)}>{evidenceCategoryLabel[c]}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Fotó</label>
          <div style={{ width: 160 }}>
            <PhotoSlot label="Fotó készítése" photo={photo} onCapture={setPhoto} />
          </div>
        </div>
        <div className="field">
          <label>Megjegyzés</label>
          <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {msg && <div className={`alert ${msg.startsWith('Hiba') ? 'error' : 'success'}`}>{msg}</div>}
        <button className="btn" disabled={!photo || busy} onClick={() => void submit()}><Icon name="save" />{busy ? 'Mentés…' : 'Fotó mentése'}</button>
        {!photo && <div className="tiny muted" style={{ textAlign: 'center' }}>Előbb készíts fotót — galériából nem tölthető fel.</div>}
      </div>

      {(list?.length ?? 0) === 0 && (
        <div className="empty"><span className="ico"><Icon name="image" size={40} /></span>Még nincs rögzített bizonyíték.</div>
      )}

      {(list?.length ?? 0) > 0 && (
        <div className="card stack">
          <div className="card-title"><Icon name="image" />Rögzített bizonyítékok</div>
          {list!.map((e) => (
            <div key={e.id} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 72, flexShrink: 0 }}>
                <PhotoThumb path={e.photo_path} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="badge">{evidenceCategoryLabel[e.category]}</span>
                  {(e.car as unknown as { plate: string } | null)?.plate && <span className="badge primary num">{(e.car as unknown as { plate: string }).plate}</span>}
                </div>
                {e.note && <div className="small" style={{ marginTop: 4 }}>{e.note}</div>}
                <div className="tiny muted">{formatDateTime(e.created_at)}</div>
                <DeductionFromEvidence evidenceId={e.id} categoryLabel={evidenceCategoryLabel[e.category]} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
