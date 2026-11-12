import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAuth } from '../context/AuthContext'
import { cleanUnmapped, mergeStopNote, unmappedKey } from '../lib/boxUnmapped'
import { signedUrl } from '../lib/photos'
import { submitNow } from '../lib/outbox'
import { itemLines, type StopItemLike } from '../lib/boxItems'
import { sharePhotos, canShareFiles } from '../lib/groupMessage'
import { STOP_FIELDS, type BoxStop, type StopNumKey } from '../lib/boxSheet'
import { toast } from '../lib/toast'
import { MAX_STOP_PHOTOS, aiPhotoPaths, photoLabel } from '../lib/stopPhotos'
import PhotoSlot, { type CapturedPhoto } from './PhotoSlot'
import CameraCapture from './CameraCapture'
import PhotoThumb from './PhotoThumb'
import Icon from './Icon'
import { errMsg } from '../lib/errors'

type Shot = CapturedPhoto & { path?: string }
type AiResult = Partial<Record<StopNumKey, number | null>> & { codes?: string[]; screen?: string | null; confidence?: number | null; note?: string | null; unmapped?: string[] }

// A box kijelzőjének fotói az appban: a kép az adatbázisba kerül, az AI kiolvassa a
// számokat (előtölti a mezőket — a futár ellenőrzi), és ugyanaz a kép egy koppintással
// a WhatsApp-csoportba megy a kész szöveggel.
export default function StopPhotos({ stop, boxLabel, boxAddress, courierName, onPatch, items = [], seqLabel = null }: {
  stop: BoxStop; boxLabel: string; boxAddress?: string | null; courierName: string; onPatch: (patch: Partial<BoxStop>) => void
  // csomagszintű eltérések (a csoportüzenetbe soronként) és a box sorszáma a járaton (n/of)
  items?: StopItemLike[]; seqLabel?: string | null
}) {
  const { currentWorkspaceId } = useWorkspace()
  const { profile } = useAuth()
  const qc = useQueryClient()
  // a most készített fotók; új fotónál a kamera EGY koppintásra nyílik (nincs üres hely, amire újra rá kell nyomni)
  const [photos, setPhotos] = useState<Shot[]>([])
  const [camOpen, setCamOpen] = useState(false)
  const [ai, setAi] = useState<AiResult | null>(null)
  const taken = photos
  const shareOk = canShareFiles()

  // A korábban feltöltött képek blobjai a WhatsApp-megosztáshoz (előre letöltve — a megosztást
  // csak koppintásra engedi a böngésző, letöltésre várni már nem lehet)
  const [savedBlobs, setSavedBlobs] = useState<Record<string, Blob>>({})
  const { data: saved } = useQuery({
    queryKey: ['stop-photos', stop.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('box_sheet_stop_photos').select('id, storage_path, ai_result, sent_at, created_at').eq('stop_id', stop.id).order('created_at')
      if (error) throw error
      return data ?? []
    },
  })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const sp of saved ?? []) {
        if (!sp.storage_path || savedBlobs[sp.storage_path]) continue
        try {
          const url = await signedUrl(sp.storage_path, 600)
          if (!url) continue
          const r = await fetch(url)
          if (r.ok && !cancelled) { const b = await r.blob(); setSavedBlobs((prev) => ({ ...prev, [sp.storage_path!]: b })) }
        } catch { /* egy hiányzó kép ne akassza meg a többit */ }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved])
  const savedPaths = (saved ?? []).map((sp) => sp.storage_path).filter((x): x is string => !!x)
  const hasAny = taken.length > 0 || savedPaths.length > 0

  // 1) feltöltés + AI-kiolvasás (a frissen készített és a korábban feltöltött képekből együtt)
  const read = useMutation({
    mutationFn: async () => {
      if (!currentWorkspaceId || !hasAny) return null
      // csak a még fel nem töltött fotók mennek fel (újbóli kiolvasásnál nem duplázódnak);
      // a feltöltés a helyi soron át megy: gyenge netnél sorba áll, és kapcsolatnál felmegy
      const fresh: string[] = []
      let queued = false
      for (const p of photos) {
        if (p.path) { fresh.push(p.path); continue }
        const id = crypto.randomUUID()
        const folder = `boxsheet/${stop.id}`
        const path = `${currentWorkspaceId}/${folder}/${id}.jpg`
        const r = await submitNow({
          id, table: 'box_sheet_stop_photos', op: 'insert', label: `Box-fotó (${stop.box_code ?? boxLabel})`,
          values: { id, workspace_id: currentWorkspaceId, stop_id: stop.id, storage_path: null },
          photo: { workspaceId: currentWorkspaceId, folder, id, column: 'storage_path', blob: p.blob },
        })
        // helyben jelöljük feltöltöttnek (közben készülhetett újabb fotó — azt nem írjuk felül)
        setPhotos((prev) => prev.map((x) => (x === p ? { ...x, path } : x)))
        if (r.queued) queued = true; else fresh.push(path)
      }
      if (queued) return 'queued' as const
      // a kiolvasó a legfrissebb képeket kapja (a korábban feltöltöttek elöl, a mostaniak a végén)
      const paths = aiPhotoPaths(fresh, savedPaths)
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
        // a kijelző egyik mezőhöz sem tartozó üzenetei: a megálló megjegyzésébe, és az admin naplójába
        const unmapped = cleanUnmapped(result.unmapped)
        result.unmapped = unmapped
        if (unmapped.length) {
          const merged = mergeStopNote(stop.note, unmapped)
          if (merged !== (stop.note ?? '').trim()) patch.note = merged
          const { error: logErr } = await supabase.from('box_unmapped_messages').insert(unmapped.map((t) => ({
            workspace_id: currentWorkspaceId, stop_id: stop.id, box_code: stop.box_code ?? null, text: t, text_key: unmappedKey(t), created_by: profile?.id ?? null,
          })))
          if (logErr) console.warn('unmapped log', logErr.message) // a napló hiánya ne akassza meg a kiolvasást
        }
        if (Object.keys(patch).length) onPatch(patch)
      }
      return result
    },
    onSuccess: (r) => {
      if (r === 'queued') { toast.info('Nincs net — a fotó sorba állt, kapcsolatnál felmegy. A kiolvasást akkor indítsd újra; a számokat addig írd be kézzel.'); return }
      setAi(r); void qc.invalidateQueries({ queryKey: ['stop-photos', stop.id] })
      const got = r ? STOP_FIELDS.some((f) => typeof r[f.key] === 'number') : false
      if (got) toast.success('Kiolvasva — ellenőrizd a számokat, és javítsd, ha kell.')
      else toast.info('A képről nem sikerült számot kiolvasni — írd be kézzel, vagy fotózd újra közelebbről, élesen.')
    },
    onError: (e) => toast.error('Kiolvasás nem sikerült: ' + (errMsg(e, 'ismeretlen hiba'))),
  })

  // 2) küldés a csoportba (a telefon megosztás-menüjén át, mint a hibánál)
  const share = useMutation({
    mutationFn: async () => {
      // Első sor: box, cím, idő, név — alatta soronként a számok, végül a megjegyzés
      const head = [seqLabel ? `${seqLabel}. box` : null, boxLabel, boxAddress, new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }), courierName].filter((x): x is string => !!x).join(' – ')
      const lines = [head, ...STOP_FIELDS.filter((f) => stop[f.key] > 0).map((f) => `${f.short}: ${stop[f.key]}`), ...itemLines(items)]
      if (stop.note) lines.push(`Megjegyzés: ${stop.note}`)
      const text = lines.join('\n')
      const blobs = [...taken.map((p) => p.blob), ...savedPaths.filter((sp) => !taken.some((p) => p.path === sp)).map((sp) => savedBlobs[sp]).filter((b): b is Blob => !!b)]
      const res = await sharePhotos(blobs, text, `box-${stop.box_code ?? 'foto'}`)
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
    <div className="stack" style={{ gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
      <div className="small" style={{ fontWeight: 700 }}><Icon name="camera" size={16} style={{ verticalAlign: -3 }} /> Fotó a box kijelzőjéről</div>
      <div className="grid-3" style={{ gap: 6 }}>
        {photos.map((p, i) => (
          <PhotoSlot key={i} label={photoLabel(i)} photo={p} onCapture={(cp) => { setAi(null); setPhotos((prev) => prev.map((x, j) => (j === i ? cp : x))) }} />
        ))}
        {photos.length < MAX_STOP_PHOTOS && (
          <button type="button" className="thumb thumb-empty" style={{ cursor: 'pointer', color: photos.length ? 'var(--primary)' : undefined }} onClick={() => setCamOpen(true)}>
            <div style={{ textAlign: 'center' }}>
              <Icon name={photos.length ? 'plus' : 'camera'} size={photos.length ? 24 : 28} />
              <div className="tiny" style={{ marginTop: photos.length ? 0 : 4 }}>{photos.length ? 'még egy fotó' : photoLabel(0)}</div>
            </div>
          </button>
        )}
      </div>
      {camOpen && (
        <CameraCapture
          title={photoLabel(photos.length)}
          onCancel={() => setCamOpen(false)}
          onCapture={(blob, previewUrl) => { setAi(null); setPhotos((prev) => [...prev, { blob, previewUrl }]); setCamOpen(false) }}
        />
      )}
      {hasAny && (
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
          {ai.unmapped && ai.unmapped.length > 0 && <div className="muted">Kijelző-üzenet a megjegyzésbe írva: {ai.unmapped.join(' · ')}</div>}
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
