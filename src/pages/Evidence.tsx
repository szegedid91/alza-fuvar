import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PhotoSlot, { type CapturedPhoto } from '../components/PhotoSlot'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { supabase } from '../lib/supabase'
import { submitNow } from '../lib/outbox'
import { evidenceCategoryLabel, formatDateTime, formatHuf, todayISO, parseHuNumber, isCrewRole } from '../lib/labels'
import { resolveNames } from '../lib/names'
import type { Enums } from '../lib/database.types'
import PhotoThumb from '../components/PhotoThumb'
import { toast } from '../lib/toast'
import { useMembers } from '../hooks/useMembers'
import { useCars } from '../hooks/useCars'
import { useCarCategories } from '../hooks/useCarCategories'
import { groupByCategory } from '../lib/calendar'
import Icon from '../components/Icon'
import ConfirmButton from '../components/ConfirmButton'

const CATS: Enums<'evidence_category'>[] = ['dirt', 'damage', 'cigarette_burn', 'other']

// Már létrehozott levonás(ok) ehhez a fotóhoz (adjustments.evidence_id) — a
// kártyán maradjon látható újratöltés után is, ne csak a mentés pillanatában
interface ExistingDeduction { id: string; amount: number; user_id: string }

function DeductionFromEvidence({ evidenceId, categoryLabel, existing, names, onCreated }: {
  evidenceId: string; categoryLabel: string; existing: ExistingDeduction[]; names: Record<string, string>; onCreated: () => void
}) {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const { data: members } = useMembers()
  const [open, setOpen] = useState(false)
  const [userId, setUserId] = useState('')
  const [amount, setAmount] = useState('')
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
    setOpen(false); setUserId(''); setAmount('')
    toast.success('Levonás rögzítve — a bérben és az Előleg / levonás oldalon látszik.')
    onCreated()
  }

  // Csak munkatársra lehet levonni — a vezetőknek nincs napidíjas bérük
  const crew = (members ?? []).filter((m) => isCrewRole(m.role))
  return (
    <div className="stack" style={{ marginTop: 6, gap: 6 }}>
      {/* whiteSpace: normal — a név + összeg telefonon kilógna az egy soros jelvényből */}
      {existing.map((d) => (
        <div key={d.id} className="badge success" style={{ width: 'fit-content', maxWidth: '100%', whiteSpace: 'normal', textAlign: 'left' }}>
          <Icon name="check" />Levonás: {formatHuf(Number(d.amount))} · {names[d.user_id] ?? 'munkatárs'}
        </div>
      ))}
      {!open && (
        <button className="btn ghost sm" style={{ width: 'fit-content' }} onClick={() => setOpen(true)}>
          <Icon name="minus" />{existing.length ? 'Újabb levonás' : 'Levonás a bérből'}
        </button>
      )}
      {open && (
    <div className="stack" style={{ marginTop: 2 }}>
      <select className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
        <option value="">— kire —</option>
        {crew.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
      </select>
      <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Összeg (Ft)" />
      {error && <div className="alert error">{error}</div>}
      <div className="btn-grid">
        <button className="btn ghost sm" onClick={() => setOpen(false)}>Mégse</button>
        {/* Bért érintő művelet — két koppintás, mint minden más véglegesítésnél */}
        <ConfirmButton className="btn sm" confirmLabel="Biztos? Levonás" disabled={busy || !userId || !amount} onConfirm={() => void create()}>
          {busy ? 'Mentés…' : 'Levonás'}
        </ConfirmButton>
      </div>
    </div>
      )}
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
    // 'v2': a válasz alakja változott ({ rows, names }) — a perzisztált régi cache ne találjon rá
    queryKey: ['evidence', currentWorkspaceId, 'v2'],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('evidence_photos')
        .select('*, car:cars(plate), deductions:adjustments(id, amount, user_id)').eq('workspace_id', currentWorkspaceId!)
        .order('created_at', { ascending: false }).limit(20)
      if (error) throw error
      const rows = data ?? []
      // Ki rögzítette + a levonások címzettjei — egy névfeloldó hívás
      const names = await resolveNames([
        ...rows.map((r) => r.created_by),
        ...rows.flatMap((r) => ((r.deductions ?? []) as ExistingDeduction[]).map((d) => d.user_id)),
      ])
      return { rows, names }
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

      {(list?.rows.length ?? 0) === 0 && (
        <div className="empty"><span className="ico"><Icon name="image" size={40} /></span>Még nincs rögzített bizonyíték.</div>
      )}

      {(list?.rows.length ?? 0) > 0 && (
        <div className="card stack">
          <div className="card-title"><Icon name="image" />Rögzített bizonyítékok</div>
          {list!.rows.map((e) => (
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
                <div className="tiny muted">{formatDateTime(e.created_at)}{e.created_by ? ` · ${list!.names[e.created_by] ?? 'vezető'}` : ''}</div>
                <DeductionFromEvidence evidenceId={e.id} categoryLabel={evidenceCategoryLabel[e.category]}
                  existing={(e.deductions ?? []) as ExistingDeduction[]} names={list!.names}
                  onCreated={() => void qc.invalidateQueries({ queryKey: ['evidence'] })} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
