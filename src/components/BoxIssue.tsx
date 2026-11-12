import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAuth } from '../context/AuthContext'
import { submitNow } from '../lib/outbox'
import { ISSUE_KINDS, issueKindLabel, issueMessage, issueStats, type IssueKind } from '../lib/boxItems'
import { openWhatsApp } from '../lib/groupMessage'
import { resolveNames } from '../lib/names'
import { formatDateTime } from '../lib/labels'
import { toast } from '../lib/toast'
import { errMsg } from '../lib/errors'
import CameraCapture from './CameraCapture'
import PhotoThumb from './PhotoThumb'
import Icon from './Icon'

// Box-hiba bejelentés (nem nyílik, szkenner, emergency, nem enged újat, biztonsági esemény):
// az appban rögzül (statisztika boxonként), és egy koppintással megy az Alza diszpécsernek a
// WhatsApp-csoportba. Biztonsági eseménynél a vezetők azonnal pusht kapnak (DB-trigger).
export function BoxIssueButton({ box, stopId = null, courierName }: {
  box: { id: string | null; code: string | null; name?: string | null }; stopId?: string | null; courierName: string
}) {
  const { currentWorkspaceId } = useWorkspace()
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<IssueKind | null>(null)
  const [note, setNote] = useState('')
  const [shots, setShots] = useState<{ blob: Blob; url: string }[]>([])
  const [cam, setCam] = useState(false)
  const reset = () => { setOpen(false); setKind(null); setNote(''); setShots([]) }
  const boxLabel = `${box.code ? box.code + (box.name ? ' · ' : '') : ''}${box.name ?? ''}` || 'box'

  const send = useMutation({
    mutationFn: async () => {
      if (!currentWorkspaceId || !kind || !profile) throw new Error('Válaszd ki a hiba típusát')
      const id = crypto.randomUUID()
      const r = await submitNow({
        id, table: 'box_issue_reports', op: 'insert', label: `Box-hiba: ${issueKindLabel(kind)}`,
        values: { id, workspace_id: currentWorkspaceId, box_id: box.id, box_code: box.code, stop_id: stopId, kind, note: note.trim() || null, created_by: profile.id },
      })
      let queued = r.queued
      for (const s of shots) {
        const pid = crypto.randomUUID()
        const pr = await submitNow({
          id: pid, table: 'box_issue_photos', op: 'insert', label: 'Box-hiba fotó',
          values: { id: pid, workspace_id: currentWorkspaceId, report_id: id, storage_path: null },
          photo: { workspaceId: currentWorkspaceId, folder: `boxissue/${id}`, id: pid, column: 'storage_path', blob: s.blob },
        })
        queued = queued || pr.queued
      }
      // a csoportba a kész szöveg — a WhatsApp ugyanazon a lapon nyílik
      openWhatsApp(issueMessage({ kind, boxLabel, at: new Date(), name: courierName, note }))
      return queued
    },
    onSuccess: (queued) => {
      reset(); void qc.invalidateQueries({ queryKey: ['box-issues'] })
      toast.success(queued ? 'Bejelentés sorba állt (nincs net) — a WhatsApp-üzenetet küldd el.' : 'Bejelentés rögzítve — a WhatsAppban válaszd a csoportot és küldd el.')
    },
    onError: (e) => toast.error(errMsg(e, 'A bejelentés nem sikerült')),
  })

  if (!open) return <button type="button" className="btn ghost sm auto" style={{ color: 'var(--danger)' }} onClick={() => setOpen(true)}><Icon name="alert-triangle" size={14} />Box-hiba</button>
  const sel = ISSUE_KINDS.find((k) => k.key === kind)
  return (
    <div className="stack" style={{ gap: 8, padding: 8, borderRadius: 10, border: `1px solid ${sel?.urgent ? 'var(--danger)' : 'var(--border)'}`, background: sel?.urgent ? 'var(--danger-ghost)' : undefined }}>
      <div className="small" style={{ fontWeight: 800 }}><Icon name="alert-triangle" size={14} /> Box-hiba — {boxLabel}</div>
      <div className="chips" style={{ gap: 6 }}>
        {ISSUE_KINDS.map((k) => <button key={k.key} type="button" className={`chip ${kind === k.key ? 'active' : ''}`} aria-pressed={kind === k.key} style={k.urgent && kind !== k.key ? { borderColor: 'var(--danger)', color: 'var(--danger)' } : undefined} onClick={() => setKind(k.key)}>{k.label}</button>)}
      </div>
      {sel && <div className="tiny muted">{sel.hint}</div>}
      <input className="input" value={note} placeholder="röviden, mi történt (nem kötelező)" onChange={(e) => setNote(e.target.value)} />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {shots.map((s, i) => <img key={i} src={s.url} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />)}
        <button type="button" className="btn ghost sm auto" onClick={() => setCam(true)}><Icon name="camera" size={14} />{shots.length ? 'még egy fotó' : sel?.urgent ? 'Fotó (kell)' : 'Fotó'}</button>
      </div>
      {cam && <CameraCapture title="Box-hiba — fotó" onCancel={() => setCam(false)} onCapture={(blob, url) => { setShots((p) => [...p, { blob, url }]); setCam(false) }} />}
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn ghost sm" style={{ flex: 1 }} onClick={reset}>Mégse</button>
        <button type="button" className="btn sm" style={{ flex: 2 }} disabled={!kind || send.isPending || (!!sel?.urgent && shots.length === 0)} onClick={() => send.mutate()}><Icon name="send" size={14} />Bejelentés és küldés a csoportba</button>
      </div>
      <div className="tiny muted">Az appban megmarad (boxonként számoljuk, ez az alap az Alzával), a csoportba a kész szöveg megy.{sel?.urgent ? ' Biztonsági eseménynél a vezetők azonnal értesítést kapnak.' : ''}</div>
    </div>
  )
}

type IssueRowFull = { id: string; box_id: string | null; box_code: string | null; kind: string; note: string | null; created_by: string | null; created_at: string; resolved_at: string | null; photos: { id: string; storage_path: string | null }[] }

// Vezetői kártya: box-hiba statisztika boxonként (hány bejelentés, milyen fajta, utolsó) + a nyitott
// bejelentések lezárása. Az utolsó 90 nap — ez a tárgyalási alap az Alza felé.
export function BoxIssueStatsCard() {
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const [openBox, setOpenBox] = useState<string | null>(null)
  const since = new Date(Date.now() - 90 * 86400_000).toISOString()
  const { data } = useQuery({
    queryKey: ['box-issues', currentWorkspaceId, 'stats'],
    enabled: !!currentWorkspaceId,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase.from('box_issue_reports').select('id, box_id, box_code, kind, note, created_by, created_at, resolved_at, photos:box_issue_photos(id, storage_path)')
        .eq('workspace_id', currentWorkspaceId!).gte('created_at', since).order('created_at', { ascending: false }).limit(500)
      if (error) throw error
      const rows = (data ?? []) as unknown as IssueRowFull[]
      const names = await resolveNames(rows.map((r) => r.created_by).filter((x): x is string => !!x))
      return { rows, names }
    },
  })
  const resolve = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('box_issue_reports').update({ resolved_at: new Date().toISOString() }).eq('id', id); if (error) throw error },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['box-issues'] }), onError: (e) => toast.error(errMsg(e, 'Nem sikerült')),
  })
  if (!data || data.rows.length === 0) return null
  const stats = issueStats(data.rows)
  const open = data.rows.filter((r) => !r.resolved_at).length
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="card-title" style={{ margin: 0 }}><Icon name="bar-chart" />Box-hibák boxonként (90 nap)</div>
      <div className="tiny muted">{data.rows.length} bejelentés, {open} nyitott. A leggyakrabban hibázó boxok elöl — koppints a részletekért. Ez az alap az Alzával egyeztetéshez.</div>
      {stats.map((s) => {
        const rows = data.rows.filter((r) => (r.box_id ?? r.box_code ?? '?') === s.key)
        return (
          <div key={s.key} className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
            <button type="button" className="between" style={{ background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', gap: 8 }} onClick={() => setOpenBox(openBox === s.key ? null : s.key)}>
              <div style={{ minWidth: 0 }}>
                <div className="small" style={{ fontWeight: 700 }}>{s.label} <span className="muted" style={{ fontWeight: 500 }}>· utoljára {formatDateTime(s.last)}</span></div>
                <div className="chips" style={{ gap: 4 }}>{Object.entries(s.kinds).map(([k, n]) => <span key={k} className={`badge ${k === 'security' ? 'danger' : 'warning'}`}>{issueKindLabel(k)} {n}</span>)}</div>
              </div>
              <div className="row" style={{ gap: 6, flexShrink: 0 }}><span className="num num-lg">{s.total}</span>{s.open > 0 && <span className="badge danger">{s.open} nyitott</span>}<Icon name={openBox === s.key ? 'chevron-up' : 'chevron-down'} className="muted" /></div>
            </button>
            {openBox === s.key && rows.map((r) => (
              <div key={r.id} className="between" style={{ gap: 8, alignItems: 'flex-start', paddingLeft: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="tiny"><strong>{issueKindLabel(r.kind)}</strong> · {formatDateTime(r.created_at)} · {r.created_by ? data.names[r.created_by] ?? '–' : '–'}{r.note ? ` — ${r.note}` : ''}</div>
                  {r.photos.length > 0 && <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 2 }}>{r.photos.map((p) => p.storage_path && <div key={p.id} style={{ width: 48 }}><PhotoThumb path={p.storage_path} /></div>)}</div>}
                </div>
                {r.resolved_at ? <span className="badge success">lezárva</span> : <button type="button" className="btn ghost sm auto" disabled={resolve.isPending} onClick={() => resolve.mutate(r.id)}>Lezárás</button>}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
