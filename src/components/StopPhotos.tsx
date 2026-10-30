import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { uploadPhoto } from '../lib/photos'
import { sharePhotos, canShareFiles } from '../lib/groupMessage'
import { STOP_FIELDS, type BoxStop, type StopNumKey } from '../lib/boxSheet'
import { toast } from '../lib/toast'
import PhotoSlot, { type CapturedPhoto } from './PhotoSlot'
import PhotoThumb from './PhotoThumb'
import Icon from './Icon'

const MAX = 4
type AiResult = Partial<Record<StopNumKey, number | null>> & { codes?: string[]; screen?: string | null; confidence?: number | null; note?: string | null }

// A box kijelzőjének fotói az appban: a kép az adatbázisba kerül, az AI kiolvassa a
// számokat (előtölti a mezőket — a futár ellenőrzi), és ugyanaz a kép egy koppintással
// a WhatsApp-csoportba megy a kész szöveggel.
export default function StopPhotos({ stop, boxLabel, courierName, onPatch }: {
  stop: BoxStop; boxLabel: string; courierName: string; onPatch: (patch: Partial<BoxStop>) => void
}) {
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const [photos, setPhotos] = useState<(CapturedPhoto | null)[]>([null])
  const [ai, setAi] = useState<AiResult | null>(null)
  const taken = photos.filter((p): p is CapturedPhoto => !!p)
  const shareOk = canShareFiles()

  const { data: saved } = useQuery({
    queryKey: ['stop-photos', stop.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('box_sheet_stop_photos').select('id, storage_path, ai_result, sent_at, created_at').eq('stop_id', stop.id).order('created_at')
      if (error) throw error
      return data ?? []
    },
  })

  // 1) feltöltés + AI-kiolvasás
  const read = useMutation({
    mutationFn: async () => {
      if (!currentWorkspaceId || taken.length === 0) return null
      const paths: string[] = []
      for (const p of taken) {
        const id = crypto.randomUUID()
        const path = await uploadPhoto(currentWorkspaceId, `boxsheet/${stop.id}`, id, p.blob)
        paths.push(path)
        const { error } = await supabase.from('box_sheet_stop_photos').insert({ id, workspace_id: currentWorkspaceId, stop_id: stop.id, storage_path: path })
        if (error) throw error
      }
      const { data, error } = await supabase.functions.invoke('read-box-photo', { body: { paths, box: stop.box_code ?? boxLabel } })
      if (error) {
        // a függvény hibaüzenete a válasz törzsében van
        let msg = error.message
        try { const ctx = (error as { context?: Response }).context; if (ctx) { const j = await ctx.json(); if (j?.error) msg = j.error } } catch { /* marad az általános üzenet */ }
        throw new Error(msg)
      }
      const result = (data as { result?: AiResult } | null)?.result ?? null
      if (result) {
        await supabase.from('box_sheet_stop_photos').update({ ai_result: result as never }).in('storage_path', paths)
        // előtöltés: csak ami kiolvasható volt
        const patch: Partial<BoxStop> = {}
        for (const f of STOP_FIELDS) { const v = result[f.key]; if (typeof v === 'number') (patch as Record<string, number>)[f.key] = v }
        if (Object.keys(patch).length) onPatch(patch)
      }
      return result
    },
    onSuccess: (r) => { setAi(r); void qc.invalidateQueries({ queryKey: ['stop-photos', stop.id] }); if (r) toast.success('Kiolvasva — ellenőrizd a számokat, és javítsd, ha kell.') },
    onError: (e) => toast.error('Kiolvasás nem sikerült: ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })

  // 2) küldés a csoportba (a telefon megosztás-menüjén át, mint a hibánál)
  const share = useMutation({
    mutationFn: async () => {
      const parts = STOP_FIELDS.filter((f) => stop[f.key] > 0).map((f) => `${f.short}: ${stop[f.key]}`)
      const text = `${boxLabel} – ${new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })} – ${courierName}${parts.length ? ` – ${parts.join(', ')}` : ''}${stop.note ? ` – ${stop.note}` : ''}`
      const res = await sharePhotos(taken.map((p) => p.blob), text, `box-${stop.box_code ?? 'foto'}`)
      if (res === 'shared') await supabase.from('box_sheet_stop_photos').update({ sent_at: new Date().toISOString() }).eq('stop_id', stop.id).is('sent_at', null)
      return res
    },
    onSuccess: (res) => {
      if (res === 'shared') { toast.success('Megosztva — a WhatsAppban válaszd a csoportot és küldd el.'); void qc.invalidateQueries({ queryKey: ['stop-photos', stop.id] }) }
      else if (res === 'cancelled') toast.info('A megosztás megszakadt — a kép az appban megvan, újra megoszthatod.')
      else toast.info('Ezen a készüléken a kép nem adható át a WhatsAppnak — a kép az appban rögzült.')
    },
  })

  return (
    <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <div className="small" style={{ fontWeight: 700 }}><Icon name="camera" size={16} style={{ verticalAlign: -3 }} /> Fotó a box kijelzőjéről</div>
      <div className="grid-3" style={{ gap: 6 }}>
        {photos.map((p, i) => (
          <PhotoSlot key={i} label={i === 0 ? 'Kijelző' : `${i + 1}. fotó`} photo={p} onCapture={(cp) => { setAi(null); setPhotos((prev) => prev.map((x, j) => (j === i ? cp : x))) }} />
        ))}
        {photos.length < MAX && taken.length === photos.length && (
          <button type="button" className="thumb thumb-empty" style={{ cursor: 'pointer', color: 'var(--primary)' }} onClick={() => setPhotos((prev) => [...prev, null])}>
            <div style={{ textAlign: 'center' }}><Icon name="plus" size={24} /><div className="tiny">még egy fotó</div></div>
          </button>
        )}
      </div>
      {taken.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn sm" style={{ flex: 1 }} disabled={read.isPending} onClick={() => read.mutate()}>
            <Icon name="sparkles" size={14} />{read.isPending ? 'Kiolvasás…' : 'Kiolvasás (AI)'}
          </button>
          <button type="button" className="btn secondary sm" style={{ flex: 1 }} disabled={share.isPending || !shareOk} title={shareOk ? undefined : 'Ezen a készüléken nem támogatott a kép megosztása'} onClick={() => share.mutate()}>
            <Icon name="send" size={14} />Küldés a csoportba
          </button>
        </div>
      )}
      {ai && (
        <div className="tiny" style={{ padding: '6px 8px', borderRadius: 8, background: 'var(--primary-ghost)' }}>
          <strong>AI olvasat</strong>{typeof ai.confidence === 'number' ? ` · biztonság ${Math.round(ai.confidence * 100)}%` : ''}{ai.screen ? ` · „${ai.screen}”` : ''}
          {ai.codes?.length ? <div className="muted">Kódok: {ai.codes.slice(0, 12).join(', ')}{ai.codes.length > 12 ? '…' : ''}</div> : null}
          {ai.note && <div className="muted">{ai.note}</div>}
          <div className="muted">A mezőket a kiolvasás előtöltötte — nézd át, és javítsd, ha a kép alapján mást látsz.</div>
        </div>
      )}
      {(saved?.length ?? 0) > 0 && (
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {saved!.map((p) => p.storage_path && (
            <div key={p.id} style={{ width: 64, position: 'relative' }}>
              <PhotoThumb path={p.storage_path} />
              {p.sent_at && <span className="badge success" style={{ position: 'absolute', right: 2, bottom: 2, fontSize: 9, padding: '0 4px' }}>küldve</span>}
            </div>
          ))}
        </div>
      )}
      <div className="tiny muted">A kép az appban is megmarad (a vezetők látják), a „Küldés a csoportba” a telefon megosztás-menüjén át a WhatsApp-csoportba küldi a szöveggel együtt.</div>
    </div>
  )
}
