import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { niceTicks } from '../../lib/chartUtils'

// Diagramok függőség nélkül (SVG). Közös szabályok: vékony jelek (oszlop legfeljebb 24 px, 4 px-es lekerekítés az
// adat-végen), 2 px-es rés a halmozott részek között, hajszálvékony rács, a szöveg mindig szövegszínű (nem a sorozaté),
// két vagy több sorozatnál jelmagyarázat, rámutatásra / fókuszra pontos érték, és minden diagramnak van táblázat-nézete.
// A sorozatszínek (--viz-1…3) az index.css-ben vannak, mindkét témára ellenőrzött (színtévesztő-biztos) sorrendben.

export function useWidth<T extends HTMLElement>(fallback = 320): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const set = () => setW(Math.max(200, Math.round(el.getBoundingClientRect().width)))
    set()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export interface Series { key: string; label: string; color: string; values: number[] }
export interface TableData { head: string[]; rows: (string | number)[][] }

// Kártya: cím, jelmagyarázat, a diagram és a táblázat-nézet váltója
export function ChartCard({ title, subtitle, legend, table, children }: {
  title: string; subtitle?: string; legend?: { label: string; color: string; line?: boolean }[]; table?: TableData; children: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
          {subtitle && <div className="tiny muted">{subtitle}</div>}
        </div>
        {table && (
          <button type="button" className="btn ghost sm auto" style={{ minHeight: 28, padding: '0 10px', fontSize: 12 }} aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}>{asTable ? 'Diagram' : 'Táblázat'}</button>
        )}
      </div>
      {legend && legend.length >= 2 && !asTable && (
        <div className="row tiny" style={{ gap: '4px 14px', flexWrap: 'wrap', color: 'var(--text-dim)' }}>
          {legend.map((l) => (
            <span key={l.label} className="row" style={{ gap: 6 }}>
              <span aria-hidden style={{ width: l.line ? 14 : 10, height: l.line ? 2 : 10, borderRadius: l.line ? 1 : 3, background: l.color, display: 'inline-block' }} />{l.label}
            </span>
          ))}
        </div>
      )}
      {asTable && table ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="viz-table">
            <thead><tr>{table.head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
    </div>
  )
}

function Tip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  // a buborék a jel fölött, a diagram szélein belül tartva
  const w = 190
  const left = Math.max(0, Math.min(x - w / 2, width - w))
  return <div className="viz-tip" role="status" style={{ left, width: w }}>{children}</div>
}

// Felül lekerekített téglalap (az oszlop adat-vége); az alap szögletes
const roundTop = (x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

// Halmozott oszlopdiagram (egy sorozattal sima oszlopdiagram): kategóriánként egy oszlop, a részek 2 px réssel
export function ColumnChart({ categories, titles, series, format, axisFormat, height = 190 }: {
  categories: string[]; titles?: string[]; series: Series[]; format: (n: number) => string; axisFormat?: (n: number) => string; height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const n = categories.length
  const totals = categories.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0))
  const ticks = niceTicks(Math.max(...totals, 0))
  const top = ticks[ticks.length - 1]
  const fmtAxis = axisFormat ?? format
  const m = { l: Math.max(30, Math.max(...ticks.map((t) => fmtAxis(t).length)) * 6.4 + 10), r: 8, t: 18, b: 22 }
  const iw = Math.max(40, width - m.l - m.r), ih = height - m.t - m.b
  const band = iw / Math.max(1, n)
  const bw = Math.max(4, Math.min(24, band * 0.62))
  const y = (v: number) => m.t + ih - (v / top) * ih
  const cx = (i: number) => m.l + band * i + band / 2
  const maxI = totals.indexOf(Math.max(...totals))
  const labelI = new Set(totals[n - 1] > 0 ? [n - 1, maxI] : [maxI])
  const every = band >= 34 ? 1 : band >= 18 ? 2 : Math.ceil(34 / band)
  return (
    <div ref={ref} className="viz" style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label="Oszlopdiagram — a pontos értékek a Táblázat nézetben">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-base' : 'viz-grid'} />
            <text x={m.l - 6} y={y(t) + 3.5} textAnchor="end" className="viz-axis">{fmtAxis(t)}</text>
          </g>
        ))}
        {categories.map((c, i) => {
          let acc = 0
          const live = series.filter((s) => (s.values[i] ?? 0) > 0)
          return (
            <g key={i} tabIndex={0} aria-label={`${titles?.[i] ?? c}: ${series.map((s) => `${s.label} ${format(s.values[i] ?? 0)}`).join(', ')}`}
              onPointerEnter={() => setHover(i)} onPointerMove={() => setHover(i)} onPointerLeave={() => setHover((h) => (h === i ? null : h))}
              onFocus={() => setHover(i)} onBlur={() => setHover((h) => (h === i ? null : h))} style={{ outline: 'none' }}>
              <rect x={m.l + band * i} y={m.t} width={band} height={ih} fill={hover === i ? 'var(--bg-elev-2)' : 'transparent'} />
              {live.map((s, k) => {
                const v = s.values[i] ?? 0
                const y1 = y(acc + v), y0 = y(acc)
                acc += v
                const isTop = k === live.length - 1
                // a rés a felület színe: az alsó rész teteje 2 px-szel lejjebb ér véget
                const h = Math.max(1, y0 - y1 - (isTop ? 0 : 2)), yy = isTop ? y1 : y1 + 2
                return isTop
                  ? <path key={s.key} d={roundTop(cx(i) - bw / 2, yy, bw, h, 4)} fill={s.color} />
                  : <rect key={s.key} x={cx(i) - bw / 2} y={yy} width={bw} height={h} fill={s.color} />
              })}
              {labelI.has(i) && totals[i] > 0 && <text x={cx(i)} y={y(totals[i]) - 5} textAnchor="middle" className="viz-label">{fmtAxis(totals[i])}</text>}
              {i % every === 0 && <text x={cx(i)} y={height - 6} textAnchor="middle" className="viz-axis">{c}</text>}
            </g>
          )
        })}
      </svg>
      {hover != null && (
        <Tip x={cx(hover)} width={width}>
          <div className="viz-tip-title">{titles?.[hover] ?? categories[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="viz-tip-row"><span className="viz-key" style={{ background: s.color }} /><strong>{format(s.values[hover] ?? 0)}</strong><span>{s.label}</span></div>
          ))}
          {series.length > 1 && <div className="viz-tip-row viz-tip-total"><span className="viz-key" style={{ background: 'transparent' }} /><strong>{format(totals[hover])}</strong><span>összesen</span></div>}
        </Tip>
      )}
    </div>
  )
}

// Vonaldiagram egy sorozattal: 2 px vonal, halvány kitöltés, a végpont jelölve; a mutató a legközelebbi pontra ugrik
export function LineChart({ points, titles, color, format, axisFormat, refLine, height = 180 }: {
  points: { label: string; value: number }[]; titles?: string[]; color: string; format: (n: number) => string; axisFormat?: (n: number) => string
  refLine?: { value: number; label: string }; height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const clip = useId()
  const n = points.length
  const ticks = niceTicks(Math.max(...points.map((p) => p.value), refLine?.value ?? 0, 0))
  const top = ticks[ticks.length - 1]
  const fmtAxis = axisFormat ?? format
  const m = { l: Math.max(30, Math.max(...ticks.map((t) => fmtAxis(t).length)) * 6.4 + 10), r: 14, t: 18, b: 22 }
  const iw = Math.max(40, width - m.l - m.r), ih = height - m.t - m.b
  const x = (i: number) => m.l + (n <= 1 ? iw / 2 : (iw * i) / (n - 1))
  const y = (v: number) => m.t + ih - (v / top) * ih
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('')
  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect()
    const rel = clientX - r.left - m.l
    setHover(Math.max(0, Math.min(n - 1, Math.round(n <= 1 ? 0 : (rel / iw) * (n - 1)))))
  }
  const labelStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 56))))
  const last = n - 1
  return (
    <div ref={ref} className="viz" style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label="Vonaldiagram — a pontos értékek a Táblázat nézetben" tabIndex={0} style={{ outline: 'none', touchAction: 'pan-y' }}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)} onPointerDown={(e) => pick(e.clientX, e.currentTarget)} onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') setHover((h) => Math.min(last, (h ?? -1) + 1)); if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - 1)) }}
        onBlur={() => setHover(null)}>
        <defs><clipPath id={clip}><rect x={m.l} y={m.t - 6} width={iw} height={ih + 6} /></clipPath></defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-base' : 'viz-grid'} />
            <text x={m.l - 6} y={y(t) + 3.5} textAnchor="end" className="viz-axis">{fmtAxis(t)}</text>
          </g>
        ))}
        {refLine && refLine.value > 0 && refLine.value <= top && (
          <g>
            <line x1={m.l} x2={width - m.r} y1={y(refLine.value)} y2={y(refLine.value)} stroke="var(--text-dim)" strokeWidth={1} />
            <text x={m.l + 4} y={y(refLine.value) - 4} textAnchor="start" className="viz-axis viz-halo">{refLine.label}</text>
          </g>
        )}
        {n > 1 && <path d={`${d}L${x(last).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`} fill={color} opacity={0.1} clipPath={`url(#${clip})`} />}
        {n > 1 && <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke="var(--text-dim)" strokeWidth={1} />}
        {n > 0 && [...new Set([last, ...(hover != null ? [hover] : [])])].map((i) => (
          <circle key={i} cx={x(i)} cy={y(points[i].value)} r={4.5} fill={color} stroke="var(--bg-elev)" strokeWidth={2} />
        ))}
        {n > 0 && hover == null && <text x={Math.min(x(last), width - m.r)} y={y(points[last].value) - 9} textAnchor="end" className="viz-label viz-halo">{format(points[last].value)}</text>}
        {points.map((p, i) => (i % labelStep === 0 || i === last) && (i === last || last - i >= labelStep) && (
          <text key={i} x={x(i)} y={height - 6} textAnchor={i === last ? 'end' : i === 0 ? 'start' : 'middle'} className="viz-axis">{p.label}</text>
        ))}
      </svg>
      {hover != null && (
        <Tip x={x(hover)} width={width}>
          <div className="viz-tip-title">{titles?.[hover] ?? points[hover].label}</div>
          <div className="viz-tip-row"><span className="viz-key" style={{ background: color }} /><strong>{format(points[hover].value)}</strong></div>
        </Tip>
      )}
    </div>
  )
}

// Rangsor: vízszintes sávok egy színnel, a legnagyobb felül, az érték a sáv végén
export function RankedBars({ rows, color, format }: { rows: { label: string; value: number; note?: string }[]; color: string; format: (n: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div className="viz-ranked">
      {rows.map((r) => (
        <div key={r.label} className="viz-ranked-row" title={r.note}>
          <span className="small" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{r.label}</span>
          <span className="viz-ranked-track"><span style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: color }} /></span>
          <span className="small num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{format(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

// Egy fő szám: címke, érték, alatta rövid magyarázat
export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="viz-stat">
      <div className="tiny muted">{label}</div>
      <div className="viz-stat-value">{value}</div>
      {sub && <div className="tiny muted">{sub}</div>}
    </div>
  )
}
