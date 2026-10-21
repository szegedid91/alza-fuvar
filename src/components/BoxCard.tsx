import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { mapsUrl, formatDistance, type AlzaBox } from '../lib/boxSheet'
import { toast } from '../lib/toast'
import Icon from './Icon'

// Egy AlzaBox "hol van?" kártyája: fotó, kód, cím, az alza.hu "hol található"
// leírása, saját megjegyzés, egy koppintásos navigáció.
export default function BoxCard({
  box, distanceM, onClose, editable = false, compact = false,
}: {
  box: AlzaBox
  distanceM?: number | null
  onClose?: () => void
  editable?: boolean
  compact?: boolean
}) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [desc, setDesc] = useState(box.description ?? '')
  const [notes, setNotes] = useState(box.notes ?? '')
  const [imgOk, setImgOk] = useState(true)

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('alza_boxes')
        .update({ description: desc.trim() || null, notes: notes.trim() || null }).eq('id', box.id)
      if (error) throw error
    },
    onSuccess: () => { setEditing(false); toast.success('Mentve.'); void qc.invalidateQueries({ queryKey: ['alza-boxes'] }) },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'A mentés nem sikerült'),
  })

  const hasGps = box.lat != null && box.lng != null

  return (
    <div className="card stack" style={{ gap: 10, borderColor: compact ? undefined : 'var(--primary)' }}>
      <div className="between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {box.code && <span className="badge primary num">{box.code}</span>}
            {distanceM != null && <span className="badge"><Icon name="navigation" />{formatDistance(distanceM)}</span>}
            {!box.active && <span className="badge danger">megszűnt</span>}
          </div>
          <div style={{ fontWeight: 800, fontSize: 16, marginTop: 4 }}>{box.name}</div>
          {box.address && <div className="small muted">{box.address}</div>}
        </div>
        {onClose && (
          <button type="button" className="icon-btn" aria-label="Bezárás" onClick={onClose}><Icon name="x" /></button>
        )}
      </div>

      {!compact && box.photo_url && imgOk && (
        <img
          src={box.photo_url} alt={`AlzaBox ${box.code ?? ''}`} loading="lazy" referrerPolicy="no-referrer"
          style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 10, background: 'var(--bg-elev-2)' }}
          onError={() => setImgOk(false)}
        />
      )}

      {editing ? (
        <>
          <div className="field">
            <label>Hol található? (leírás)</label>
            <textarea className="textarea" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="field">
            <label>Saját megjegyzés (pl. parkolás, kapukód, tipp)</label>
            <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm auto" disabled={save.isPending} onClick={() => save.mutate()}><Icon name="save" size={16} />Mentés</button>
            <button type="button" className="btn ghost sm auto" onClick={() => { setEditing(false); setDesc(box.description ?? ''); setNotes(box.notes ?? '') }}>Mégse</button>
          </div>
        </>
      ) : (
        <>
          {box.description ? (
            <div className="alert info row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <Icon name="map-pin" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{box.description}</span>
            </div>
          ) : (
            <div className="tiny muted">Ehhez a boxhoz nincs „hol található" leírás az alza.hu-n.</div>
          )}
          {box.notes && (
            <div className="small row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <Icon name="info" size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--warning)' }} />
              <span>{box.notes}</span>
            </div>
          )}
        </>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {hasGps && (
          <a className="btn auto" href={mapsUrl(box.lat!, box.lng!)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            <Icon name="navigation" />Navigáció
          </a>
        )}
        {box.article_url && (
          <a className="btn ghost auto" href={box.article_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            <Icon name="package" />alza.hu
          </a>
        )}
        {editable && !editing && (
          <button type="button" className="btn ghost auto" onClick={() => setEditing(true)}><Icon name="pencil" />Szerkesztés</button>
        )}
      </div>
    </div>
  )
}
