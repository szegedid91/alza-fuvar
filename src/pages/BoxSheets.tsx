import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useWorkspace } from '../context/WorkspaceContext'
import { monthRange, currentYm } from '../lib/payroll'
import { shiftMonth, monthTitle } from '../lib/calendar'
import { resolveNames } from '../lib/names'
import { formatDate } from '../lib/labels'
import { exportRowsToXlsx } from '../lib/export'
import { STOP_FIELDS, COMP_FIELDS, RET_FIELDS, WH_FIELDS, stopTotals, hhmm, hhmmOfISO, normalize, type BoxSheet, type BoxStop } from '../lib/boxSheet'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'

// Vezetői nézet: a hónap Box-lapjai (ki, mikor, melyik autóval, hány box,
// mennyi csomag / hiány / visszáru), lap-részletek táblázatban, keresés box-kódra
// ("ezt a boxot ki vitte, mikor, mi volt vele") és Excel export.
type SheetRow = BoxSheet & { car: { plate: string } | null; stops: BoxStop[]; _name: string | null }

const cell: React.CSSProperties = { padding: '4px 6px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const numCell: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

export default function BoxSheets() {
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const [ym, setYm] = useState(currentYm())
  const range = useMemo(() => monthRange(ym), [ym])
  const [codeQ, setCodeQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['box-sheets', currentWorkspaceId, ym],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const rows = await fetchAll<SheetRow>((f, t) =>
        supabase.from('box_sheets').select('*, car:cars(plate), stops:box_sheet_stops(*)')
          .eq('workspace_id', currentWorkspaceId!).gte('work_date', range.start).lt('work_date', range.endExclusive)
          .order('work_date', { ascending: false }).order('id').range(f, t) as unknown as PromiseLike<{ data: SheetRow[] | null; error: { message: string } | null }>)
      const names = await resolveNames(rows.map((r) => r.user_id))
      return rows.map((r) => ({ ...r, _name: names[r.user_id] ?? null, stops: [...(r.stops ?? [])].sort((a, b) => a.seq - b.seq || a.created_at.localeCompare(b.created_at)) }))
    },
  })

  const sheets = data ?? []
  const allStops = useMemo(() => sheets.flatMap((s) => s.stops.map((st) => ({ ...st, _sheet: s }))), [sheets])
  const totals = useMemo(() => stopTotals(allStops), [allStops])

  const codeHits = useMemo(() => {
    const q = normalize(codeQ).trim()
    if (q.length < 2) return []
    return allStops.filter((st) => normalize(st.box_code).includes(q) || normalize(st.box_name).includes(q))
      .sort((a, b) => b._sheet.work_date.localeCompare(a._sheet.work_date))
  }, [allStops, codeQ])

  const byDate = useMemo(() => {
    const m = new Map<string, SheetRow[]>()
    for (const s of sheets) m.set(s.work_date, [...(m.get(s.work_date) ?? []), s])
    return [...m.entries()]
  }, [sheets])

  async function exportStops() {
    const rows = allStops.map((st) => ({
      'Dátum': st._sheet.work_date, 'Név': st._sheet._name ?? '', 'Autó': st._sheet.car?.plate ?? '',
      'Indulás': hhmm(st._sheet.start_time), 'Végzés': hhmm(st._sheet.end_time),
      '#': st.seq, 'Box kód': st.box_code ?? '', 'Box': st.box_name ?? '',
      ...Object.fromEntries(STOP_FIELDS.map((f) => [f.short, st[f.key]])),
      'Megjegyzés': st.note ?? '',
    }))
    await exportRowsToXlsx(`box-megallok-${ym}.xlsx`, 'Megállók', rows)
  }
  async function exportSheets() {
    const rows = sheets.map((s) => {
      const t = stopTotals(s.stops)
      return {
        'Dátum': s.work_date, 'Név': s._name ?? '', 'Autó': s.car?.plate ?? '', 'Állapot': s.status === 'submitted' ? 'lezárva' : 'piszkozat',
        'Indulás': hhmm(s.start_time), 'Végzés': hhmm(s.end_time), 'Megállók': s.stops.length,
        ...Object.fromEntries(STOP_FIELDS.map((f) => [`Σ ${f.short}`, t[f.key]])),
        ...Object.fromEntries(WH_FIELDS.map((f) => [f.label, s[f.key]])), 'Raktári megjegyzés': s.wh_note ?? '',
        ...Object.fromEntries(COMP_FIELDS.map((f) => [f.label, s[f.key]])), 'Egyéb komplikáció': s.comp_note ?? '',
        ...Object.fromEntries(RET_FIELDS.map((f) => [`Leadott ${f.label}`, s[f.key]])),
      }
    })
    await exportRowsToXlsx(`box-lapok-${ym}.xlsx`, 'Box-lapok', rows)
  }

  return (
    <div className="stack">
      <h2>Box-lapok</h2>
      <div className="card between">
        <button className="icon-btn" onClick={() => setYm(shiftMonth(ym, -1))} aria-label="Előző hónap"><Icon name="chevron-left" /></button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 800 }}>{monthTitle(ym)}</div>
          <div className="tiny muted">{currentWorkspace?.name}</div>
        </div>
        <button className="icon-btn" onClick={() => setYm(shiftMonth(ym, 1))} aria-label="Következő hónap"><Icon name="chevron-right" /></button>
      </div>

      {isLoading && <Skeleton rows={4} />}
      {isError && <div className="alert error">Nem sikerült betölteni: {error instanceof Error ? error.message : ''}</div>}

      {data && (
        <>
          <div className="card stack" style={{ gap: 6 }}>
            <div className="between">
              <span className="muted small">Lapok / megállók</span>
              <span className="num">{sheets.length} / {allStops.length}</span>
            </div>
            <div className="grid-2" style={{ gap: 4 }}>
              {STOP_FIELDS.map((f) => (
                <div key={f.key} className="between">
                  <span className="tiny muted">Σ {f.short}</span>
                  <span className="num" style={{ color: f.key !== 'placed' && totals[f.key] > 0 ? 'var(--warning)' : undefined }}>{totals[f.key]}</span>
                </div>
              ))}
            </div>
            {sheets.length > 0 && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <button className="btn ghost sm auto" onClick={() => void exportStops()}><Icon name="file-text" size={16} />Export: megállók</button>
                <button className="btn ghost sm auto" onClick={() => void exportSheets()}><Icon name="file-text" size={16} />Export: lapok</button>
              </div>
            )}
          </div>

          <div className="card stack" style={{ gap: 8 }}>
            <div className="card-title" style={{ margin: 0 }}><Icon name="search" />Box keresése a hónapban</div>
            <div className="input-icon">
              <Icon name="search" />
              <input className="input" value={codeQ} onChange={(e) => setCodeQ(e.target.value)} placeholder="Box kód vagy név (pl. AB9763)" autoComplete="off" />
            </div>
            {codeQ.trim().length >= 2 && codeHits.length === 0 && <div className="tiny muted">Nincs ilyen box ebben a hónapban.</div>}
            {codeHits.slice(0, 30).map((st) => {
              const extras = STOP_FIELDS.filter((f) => f.key !== 'placed' && st[f.key] > 0)
              return (
                <button key={st.id} type="button" className="list-item" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', padding: '8px 12px' }}
                  onClick={() => setOpenId(st._sheet.id)}>
                  <div className="between" style={{ gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="small" style={{ fontWeight: 700 }}><span className="num">{st.box_code ?? '—'}</span> · {formatDate(st._sheet.work_date)} · {st._sheet._name ?? '–'}</div>
                      <div className="chips" style={{ gap: 4, marginTop: 2 }}>
                        <span className="badge">{st.placed} db behelyezve</span>
                        {extras.map((f) => <span key={f.key} className="badge warning">{f.short} {st[f.key]}</span>)}
                      </div>
                      {st.note && <div className="tiny muted">{st.note}</div>}
                    </div>
                    <Icon name="chevron-right" className="muted" />
                  </div>
                </button>
              )
            })}
          </div>

          {sheets.length === 0 && <div className="empty"><span className="ico"><Icon name="package" size={40} /></span>Ebben a hónapban nincs Box-lap.</div>}

          {byDate.map(([date, list]) => (
            <div key={date} className="stack" style={{ gap: 8 }}>
              <div className="tiny muted" style={{ fontWeight: 700 }}>{formatDate(date)}</div>
              {list.map((s) => {
                const t = stopTotals(s.stops)
                const open = openId === s.id
                const issues = t.shortage + t.damaged + t.left_on_car + t.returned
                return (
                  <div key={s.id} className="card stack" style={{ gap: 8, borderColor: open ? 'var(--primary)' : undefined }}>
                    <button type="button" className="between" style={{ background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', gap: 8 }}
                      onClick={() => setOpenId(open ? null : s.id)}>
                      <div style={{ minWidth: 0 }}>
                        <div className="small" style={{ fontWeight: 800 }}>{s._name ?? '–'} <span className="muted" style={{ fontWeight: 500 }}>· {s.car?.plate ?? 'autó nélkül'}</span></div>
                        <div className="tiny muted">{s.stops.length} box · {t.placed} db · {hhmm(s.start_time)}–{hhmm(s.end_time)}</div>
                      </div>
                      <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                        {issues > 0 && <span className="badge warning">{issues} eltérés</span>}
                        {s.status === 'submitted' ? <span className="badge success"><Icon name="check" />Lezárva</span> : <span className="badge">Piszkozat</span>}
                        <Icon name={open ? 'chevron-up' : 'chevron-down'} className="muted" />
                      </div>
                    </button>
                    {open && <SheetDetail sheet={s} />}
                  </div>
                )
              })}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function SheetDetail({ sheet: s }: { sheet: SheetRow }) {
  const t = stopTotals(s.stops)
  const whItems = WH_FIELDS.filter((f) => s[f.key] > 0).map((f) => `${f.label}: ${s[f.key]}`)
  const compItems = COMP_FIELDS.filter((f) => s[f.key] > 0).map((f) => `${f.short}: ${s[f.key]}`)
  const retItems = RET_FIELDS.map((f) => `${f.label}: ${s[f.key]}`)
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="tiny muted">
        Indulás {hhmm(s.start_time)} · végzés {hhmm(s.end_time)}
        {s.submitted_at && ` · lezárva ${hhmmOfISO(s.submitted_at)}`}
      </div>
      {s.stops.length === 0 ? <div className="tiny muted">Nincs megálló.</div> : (
        <div style={{ overflowX: 'auto', margin: '0 -4px' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead>
              <tr>
                <th style={cell}>#</th><th style={{ ...cell, textAlign: 'left' }}>Box</th>
                {STOP_FIELDS.map((f) => <th key={f.key} style={numCell} title={f.label}>{f.short}</th>)}
                <th style={{ ...cell, textAlign: 'left' }}>Megj.</th>
              </tr>
            </thead>
            <tbody>
              {s.stops.map((st, i) => (
                <tr key={st.id}>
                  <td style={numCell}>{i + 1}</td>
                  <td style={cell}><span className="num">{st.box_code ?? '—'}</span> <span className="muted">{st.box_name ?? ''}</span></td>
                  {STOP_FIELDS.map((f) => (
                    <td key={f.key} style={{ ...numCell, color: f.key !== 'placed' && st[f.key] > 0 ? 'var(--warning)' : st[f.key] === 0 ? 'var(--text-dim)' : undefined, fontWeight: st[f.key] > 0 ? 700 : 400 }}>{st[f.key]}</td>
                  ))}
                  <td style={{ ...cell, whiteSpace: 'normal', minWidth: 120 }}>{st.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 800 }}>
                <td style={cell}></td><td style={cell}>Összesen</td>
                {STOP_FIELDS.map((f) => <td key={f.key} style={numCell}>{t[f.key]}</td>)}
                <td style={cell}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="small"><span className="muted">Raktári: </span>{whItems.length ? whItems.join(' · ') : 'nincs'}{s.wh_note ? ` · ${s.wh_note}` : ''}</div>
      <div className="small"><span className="muted">Komplikációk: </span>{compItems.length ? compItems.join(' · ') : 'nincs'}{s.comp_note ? ` · ${s.comp_note}` : ''}</div>
      <div className="small"><span className="muted">Raktárban leadott: </span>{retItems.join(' · ')}</div>
      <Link to={`/box-lap?sheet=${s.id}`} className="btn ghost sm" style={{ textDecoration: 'none' }}><Icon name="pencil" size={16} />Lap szerkesztése</Link>
    </div>
  )
}
