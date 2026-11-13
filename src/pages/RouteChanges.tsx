import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { resolveNames } from '../lib/names'
import { formatDateTime } from '../lib/labels'
import { boxLabel, diffUploads, groupUploads, hm, type PlanVersion, type Upload, type UploadDiff } from '../lib/routeHistory'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'
import { errMsg } from '../lib/errors'

// Járat-változások (admin): minden járatterv-feltöltés pillanatképe, és feltöltésről feltöltésre
// mi változott — boxok száma járatonként, új / lekerült / áthelyezett boxok, sorrend, tervezett idők.
export default function RouteChanges() {
  const { currentWorkspaceId } = useWorkspace()
  const [sel, setSel] = useState<string | null>(null)
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['route-plan-versions', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('route_plan_versions').select('id, route_id, code, source, imported_at, imported_by, planned_start, planned_end, stops')
        .eq('workspace_id', currentWorkspaceId!).order('imported_at')
      if (error) throw error
      const versions = (data ?? []) as unknown as PlanVersion[]
      const names = await resolveNames(versions.map((v) => v.imported_by).filter((x): x is string => !!x))
      return { versions, names }
    },
  })
  const uploads = useMemo(() => groupUploads(data?.versions ?? []), [data])
  const diffs = useMemo(() => uploads.map((u, i) => diffUploads(i > 0 ? uploads[i - 1] : null, u)), [uploads])
  const routeCodes = useMemo(() => [...new Set(uploads.flatMap((u) => u.routes.map((r) => r.code)))].sort(), [uploads])
  const selIdx = Math.max(0, sel ? uploads.findIndex((u) => u.key === sel) : uploads.length - 1)

  if (isLoading) return <div className="stack"><h2>Járat-változások</h2><Skeleton rows={6} /></div>
  if (isError) return <div className="stack"><h2>Járat-változások</h2><div className="alert error">{errMsg(error, 'Nem sikerült betölteni')}</div></div>
  if (uploads.length === 0) return (
    <div className="stack"><h2>Járat-változások</h2>
      <div className="empty"><span className="ico"><Icon name="map" size={40} /></span>Még nincs betöltött járatterv. <Link to="/jaratok">Járatok</Link></div>
    </div>
  )
  const cur = uploads[selIdx], curDiff = diffs[selIdx], prev = selIdx > 0 ? uploads[selIdx - 1] : null

  return (
    <div className="stack">
      <h2>Járat-változások</h2>
      <p className="small muted" style={{ margin: 0 }}>Minden járatterv-feltöltés (csütörtöki xlsx) pillanatképe megmarad; itt látod, feltöltésről feltöltésre mi változott: boxok száma, új és lekerült boxok, járatok közti áthelyezés, sorrend és a tervezett idők.</p>

      <div className="card stack" style={{ gap: 8 }}>
        <div className="card-title" style={{ margin: 0 }}><Icon name="bar-chart" />Boxok száma járatonként, feltöltésenként</div>
        <StackedBars uploads={uploads} codes={routeCodes} />
        <Legend codes={routeCodes} />
      </div>

      <div className="card stack" style={{ gap: 8 }}>
        <div className="card-title" style={{ margin: 0 }}><Icon name="trending-up" />Változások feltöltésenként</div>
        <ChangeBars uploads={uploads} diffs={diffs} />
        <div className="chips" style={{ gap: 6 }}>
          {CHANGE_KEYS.map((k) => <span key={k.key} className="tiny row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: k.color, display: 'inline-block' }} />{k.label}</span>)}
        </div>
        <div className="tiny muted">Új = sehol nem volt a korábbi tervben; lekerült = sehol sincs az újban; áthelyezett = másik járatba került; sorrend = közös box, amelynek változott a helye; idő = közös box, más tervezett érkezéssel.</div>
      </div>

      <div className="card stack" style={{ gap: 8 }}>
        <div className="card-title" style={{ margin: 0 }}><Icon name="clock" />Feltöltések</div>
        {uploads.map((u, i) => {
          const d = diffs[i]
          const active = i === selIdx
          return (
            <button key={u.key} type="button" className="between" style={{ background: active ? 'var(--primary-ghost)' : 'none', border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 10, padding: 8, width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', gap: 8 }} onClick={() => setSel(u.key)}>
              <div style={{ minWidth: 0 }}>
                <div className="small" style={{ fontWeight: 700 }}>{formatDateTime(u.at)} <span className="muted" style={{ fontWeight: 500 }}>· {u.source ?? 'ismeretlen fájl'}</span></div>
                <div className="tiny muted">{u.by ? data?.names[u.by] ?? '–' : '–'} · {u.routes.length} járat · {d.totals.boxes} box{i > 0 ? ` (${d.totals.boxes - d.totals.prevBoxes >= 0 ? '+' : ''}${d.totals.boxes - d.totals.prevBoxes})` : ''}</div>
              </div>
              <div className="chips" style={{ gap: 4, flexShrink: 0 }}>
                {i === 0 ? <span className="badge">első</span> : <>
                  {d.totals.added > 0 && <span className="badge success">+{d.totals.added}</span>}
                  {d.totals.removed > 0 && <span className="badge danger">−{d.totals.removed}</span>}
                  {d.totals.moved > 0 && <span className="badge warning">↔ {d.totals.moved}</span>}
                  {d.totals.reordered > 0 && <span className="badge">sorrend {d.totals.reordered}</span>}
                  {d.totals.etaChanged > 0 && <span className="badge">idő {d.totals.etaChanged}</span>}
                  {d.totals.added + d.totals.removed + d.totals.moved + d.totals.reordered + d.totals.etaChanged === 0 && <span className="badge">nincs változás</span>}
                </>}
              </div>
            </button>
          )
        })}
      </div>

      <div className="card stack" style={{ gap: 10 }}>
        <div className="card-title" style={{ margin: 0 }}><Icon name="map" />Részletek — {formatDateTime(cur.at)}{prev ? <span className="muted" style={{ fontWeight: 500 }}> (az előzőhöz, {formatDateTime(prev.at)}, képest)</span> : <span className="muted" style={{ fontWeight: 500 }}> (első betöltés)</span>}</div>
        {curDiff.routes.map((r) => <RouteDetail key={r.code} r={r} upload={cur} />)}
      </div>
    </div>
  )
}

const CHANGE_KEYS: { key: keyof UploadDiff['totals']; label: string; color: string }[] = [
  { key: 'added', label: 'új', color: 'var(--success)' },
  { key: 'removed', label: 'lekerült', color: 'var(--danger)' },
  { key: 'moved', label: 'áthelyezett', color: 'var(--warning)' },
  { key: 'reordered', label: 'sorrend', color: 'var(--primary)' },
  { key: 'etaChanged', label: 'idő', color: 'var(--text-dim)' },
]
const routeColor = (i: number) => `hsl(${(i * 67 + 200) % 360} 65% 55%)`
const shortDate = (iso: string) => { const d = new Date(iso); return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}.` }

function Legend({ codes }: { codes: string[] }) {
  return <div className="chips" style={{ gap: 8 }}>{codes.map((c, i) => <span key={c} className="tiny row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: routeColor(i), display: 'inline-block' }} />{c} járat</span>)}</div>
}

// Halmozott oszlopok: feltöltésenként egy oszlop, járatonként színes szelet, felül az összes
function StackedBars({ uploads, codes }: { uploads: Upload[]; codes: string[] }) {
  const W = 640, H = 220, padL = 32, padB = 28, padT = 18
  const totals = uploads.map((u) => u.routes.reduce((n, r) => n + r.stops.length, 0))
  const max = Math.max(1, ...totals)
  const bw = Math.min(56, (W - padL - 8) / uploads.length - 12)
  const x = (i: number) => padL + 8 + i * ((W - padL - 8) / uploads.length) + ((W - padL - 8) / uploads.length - bw) / 2
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Boxok száma feltöltésenként">
      {[0, 0.5, 1].map((f) => <g key={f}><line x1={padL} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" /><text x={padL - 4} y={y(max * f) + 4} fontSize="10" textAnchor="end" fill="var(--text-dim)">{Math.round(max * f)}</text></g>)}
      {uploads.map((u, i) => {
        let acc = 0
        return (
          <g key={u.key}>
            {codes.map((c, ci) => {
              const n = u.routes.find((r) => r.code === c)?.stops.length ?? 0
              if (!n) return null
              const y0 = y(acc + n), h = y(acc) - y(acc + n); acc += n
              return <g key={c}><rect x={x(i)} y={y0} width={bw} height={h} fill={routeColor(ci)} rx={2}><title>{c} járat: {n} box</title></rect>{h > 12 && <text x={x(i) + bw / 2} y={y0 + h / 2 + 4} fontSize="10" textAnchor="middle" fill="#fff">{n}</text>}</g>
            })}
            <text x={x(i) + bw / 2} y={y(totals[i]) - 4} fontSize="11" fontWeight="700" textAnchor="middle" fill="var(--text)">{totals[i]}</text>
            <text x={x(i) + bw / 2} y={H - 10} fontSize="10" textAnchor="middle" fill="var(--text-dim)">{shortDate(u.at)}</text>
          </g>
        )
      })}
    </svg>
  )
}

// Csoportos oszlopok: feltöltésenként a változás-fajták darabszáma
function ChangeBars({ uploads, diffs }: { uploads: Upload[]; diffs: UploadDiff[] }) {
  const W = 640, H = 200, padL = 28, padB = 28, padT = 14
  const max = Math.max(1, ...diffs.slice(1).flatMap((d) => CHANGE_KEYS.map((k) => d.totals[k.key])))
  const slot = (W - padL - 8) / uploads.length
  const bw = Math.max(4, Math.min(14, (slot - 10) / CHANGE_KEYS.length))
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Változások feltöltésenként">
      {[0, 0.5, 1].map((f) => <g key={f}><line x1={padL} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" /><text x={padL - 4} y={y(max * f) + 4} fontSize="10" textAnchor="end" fill="var(--text-dim)">{Math.round(max * f)}</text></g>)}
      {uploads.map((u, i) => {
        const x0 = padL + 8 + i * slot + (slot - bw * CHANGE_KEYS.length) / 2
        return (
          <g key={u.key}>
            {i > 0 && CHANGE_KEYS.map((k, ki) => {
              const v = diffs[i].totals[k.key]
              return <g key={k.key}><rect x={x0 + ki * bw} y={y(v)} width={bw - 1} height={y(0) - y(v)} fill={k.color} rx={1}><title>{k.label}: {v}</title></rect>{v > 0 && <text x={x0 + ki * bw + bw / 2} y={y(v) - 3} fontSize="9" textAnchor="middle" fill="var(--text)">{v}</text>}</g>
            })}
            {i === 0 && <text x={padL + 8 + i * slot + slot / 2} y={y(0) - 6} fontSize="10" textAnchor="middle" fill="var(--text-dim)">első betöltés</text>}
            <text x={padL + 8 + i * slot + slot / 2} y={H - 10} fontSize="10" textAnchor="middle" fill="var(--text-dim)">{shortDate(u.at)}</text>
          </g>
        )
      })}
    </svg>
  )
}

function RouteDetail({ r, upload }: { r: UploadDiff['routes'][number]; upload: Upload }) {
  const [open, setOpen] = useState(r.status !== 'same')
  const ver = upload.routes.find((v) => v.code === r.code)
  const badge = r.status === 'new' ? <span className="badge success">új járat</span> : r.status === 'removed' ? <span className="badge danger">megszűnt</span> : r.status === 'same' ? <span className="badge">nincs változás</span> : <span className="badge warning">változott</span>
  const shift = r.etaShifts.length ? Math.round(r.etaShifts.reduce((n, s) => n + s.minutes, 0) / r.etaShifts.length) : 0
  return (
    <div className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <button type="button" className="between" style={{ background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', gap: 8 }} onClick={() => setOpen((o) => !o)}>
        <div className="small" style={{ fontWeight: 800 }}>{r.code} járat <span className="muted" style={{ fontWeight: 500 }}>· {r.prevCount !== r.count && r.status !== 'new' ? `${r.prevCount} → ` : ''}{r.count} box{ver?.planned_start ? ` · indulás ${hm(ver.planned_start)}` : ''}</span></div>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>{badge}<Icon name={open ? 'chevron-up' : 'chevron-down'} className="muted" /></div>
      </button>
      {open && (
        <div className="stack tiny" style={{ gap: 3 }}>
          {r.startFrom !== r.startTo && r.status === 'changed' && <div><Icon name="clock" size={12} /> Tervezett indulás: {hm(r.startFrom)} → {hm(r.startTo)}</div>}
          {r.added.length > 0 && <div><span style={{ color: 'var(--success)', fontWeight: 700 }}>+ {r.added.length}</span> {r.added.map((a) => a.from ? `${boxLabel(a.code)} (${a.from}-ből)` : boxLabel(a.code)).join(', ')}</div>}
          {r.removed.length > 0 && <div><span style={{ color: 'var(--danger)', fontWeight: 700 }}>− {r.removed.length}</span> {r.removed.map((x) => x.to ? `${boxLabel(x.code)} (→ ${x.to})` : boxLabel(x.code)).join(', ')}</div>}
          {r.reordered > 0 && <div><Icon name="repeat" size={12} /> {r.reordered} box más helyre került a sorrendben</div>}
          {r.etaShifts.length > 0 && <div><Icon name="clock" size={12} /> {r.etaShifts.length} boxnál más a tervezett érkezés (átlag {shift >= 0 ? '+' : ''}{shift} perc): {r.etaShifts.slice(0, 6).map((s) => `${s.code} ${hm(s.from)}→${hm(s.to)}`).join(', ')}{r.etaShifts.length > 6 ? '…' : ''}</div>}
          {ver && <div className="muted" style={{ wordBreak: 'break-word' }}>Sorrend: {ver.stops.map((s, i) => `${i + 1}. ${boxLabel(s.code ?? s.box_id)}${s.eta ? ` (${hm(s.eta)})` : ''}`).join(' · ')}</div>}
        </div>
      )}
    </div>
  )
}
