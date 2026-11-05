import { useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import type { Car } from '../hooks/useCars'
import { carQrPayload, qrDataUrl } from '../lib/qr'
import { QR_SIZES, qrSizeOf, qrCellLayout, paginate, cqw, type QrSizeKey } from '../lib/qrPrint'
import Icon from './Icon'

const SIZE_KEY = 'alza-qr-print-size'

// Nyomtatáskor csak a lapok maradnak: a keret, a menük és a beállító kártya eltűnik,
// a lap pontosan A4 (margó nélkül), így a választott méret a papíron is annyi.
const PRINT_CSS = `
@page { size: A4 portrait; margin: 0; }
@media print {
  html, body, #root { height: auto !important; background: #fff !important; }
  .app { display: block !important; min-height: 0 !important; }
  .app > :not(.content) { display: none !important; }
  .content { max-width: none !important; padding: 0 !important; margin: 0 !important; }
  .content > :not(.qr-print-root) { display: none !important; }
  .qr-print-root, .qr-sheet { display: block !important; gap: 0 !important; }
  .qr-page { width: 210mm !important; height: 296.5mm !important; aspect-ratio: auto !important; border-radius: 0 !important; box-shadow: none !important; break-after: page; page-break-after: always; break-inside: avoid; }
  .qr-page:last-child { break-after: auto; page-break-after: auto; }
}`

// QR-kódok nyomtatása: választható méret (alapból fél A4), kijelölhető autók, élő előnézet.
export default function QrPrintSheet({ cars, initialIds, onBack }: { cars: Car[]; initialIds?: string[]; onBack: () => void }) {
  const [sizeKey, setSizeKey] = useState<QrSizeKey>(() => { try { return qrSizeOf(localStorage.getItem(SIZE_KEY)).key } catch { return qrSizeOf(null).key } })
  const [selected, setSelected] = useState<string[]>(() => initialIds ?? cars.map((c) => c.id))
  const size = qrSizeOf(sizeKey)
  const layout = qrCellLayout(size)

  const chosen = useMemo(() => cars.filter((c) => selected.includes(c.id)), [cars, selected])
  const pages = useMemo(() => paginate(chosen, layout.perPage), [chosen, layout.perPage])

  // Nagy felbontású kód — egész A4-en is éles marad
  const qrs = useQueries({
    queries: chosen.map((c) => ({ queryKey: ['qr', c.id, 'print'], queryFn: () => qrDataUrl(carQrPayload(c.qr_token), 1024), staleTime: Infinity })),
  })
  const urlOf = new Map(chosen.map((c, i) => [c.id, qrs[i]?.data]))
  const ready = chosen.length > 0 && qrs.every((q) => !!q.data)

  function pickSize(k: QrSizeKey) {
    setSizeKey(k)
    try { localStorage.setItem(SIZE_KEY, k) } catch { /* privát mód: csak erre a megnyitásra szól */ }
  }
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <div className="stack qr-print-root">
      <style>{PRINT_CSS}</style>
      <div className="card stack no-print">
        <div className="between">
          <div className="card-title" style={{ margin: 0 }}><Icon name="printer" />QR-kódok nyomtatása</div>
          <button className="btn ghost sm auto" onClick={onBack}><Icon name="arrow-left" />Vissza</button>
        </div>

        <div className="field">
          <label>Méret (egy kód mekkora legyen)</label>
          <div className="chips">
            {QR_SIZES.map((s) => (
              <button key={s.key} type="button" aria-pressed={s.key === sizeKey} className={`chip day-chip ${s.key === sizeKey ? 'active' : ''}`} onClick={() => pickSize(s.key)}>
                <span>{s.label}</span>
                <span className="day-chip-sub">{s.sub}</span>
              </button>
            ))}
          </div>
          <div className="tiny muted">
            A kód oldala kb. {Math.round(layout.qr / 10)} cm, a cella {Math.round(layout.cellW)} × {Math.round(layout.cellH)} mm. A szaggatott vonal mentén vágható.
          </div>
        </div>

        <div className="field">
          <label>Mely autók ({chosen.length} / {cars.length})</label>
          <div className="chips">
            {cars.map((c) => (
              <button key={c.id} type="button" aria-pressed={selected.includes(c.id)} className={`chip ${selected.includes(c.id) ? 'active' : ''}`} style={{ minHeight: 34, padding: '4px 10px' }} onClick={() => toggle(c.id)}>
                {c.plate}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="link-btn" style={{ width: 'auto', fontSize: 13, padding: '6px 8px' }} onClick={() => setSelected(cars.map((c) => c.id))}>Mind</button>
            <button type="button" className="link-btn" style={{ width: 'auto', fontSize: 13, padding: '6px 8px' }} onClick={() => setSelected([])}>Egyik sem</button>
          </div>
        </div>

        <button className="btn" disabled={!ready} onClick={() => window.print()}>
          <Icon name="printer" />{chosen.length === 0 ? 'Válassz autót' : ready ? `Nyomtatás — ${chosen.length} kód, ${pages.length} lap` : 'Kódok készülnek…'}
        </button>
        <p className="tiny muted" style={{ margin: 0 }}>
          A nyomtatási ablakban A4 papírt és 100%-os (tényleges) méretet válassz, margó nélkül — „laphoz igazítás” mellett a kód kisebb lesz.
        </p>
      </div>

      <div className="qr-sheet">
        {pages.map((page, pi) => (
          <div key={pi} className={`qr-page ${layout.perPage > 1 ? 'cut' : ''}`} style={{ gridTemplateColumns: `repeat(${size.cols}, 1fr)`, gridTemplateRows: `repeat(${size.rows}, 1fr)` }}>
            {page.map((c) => (
              <div key={c.id} className="qr-cell">
                {urlOf.get(c.id)
                  ? <img src={urlOf.get(c.id)} alt={`QR ${c.plate}`} style={{ width: cqw(layout.qr), height: cqw(layout.qr) }} />
                  : <div style={{ width: cqw(layout.qr), height: cqw(layout.qr) }} />}
                <div className="qr-plate" style={{ fontSize: cqw(layout.plateFont) }}>{c.plate}</div>
                {c.label && <div style={{ fontSize: cqw(layout.textFont), color: '#444' }}>{c.label}</div>}
                <div style={{ fontSize: cqw(layout.textFont), color: '#666' }}>Alza — becsekkoláshoz olvasd be</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
