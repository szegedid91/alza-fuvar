// Átvételi bizonylat a készpénzben kifizetett előlegről: nyomtatható, két példányban egy A4-es
// lapon (egy a kifizetőé, egy az átvevőé) — aláírva igazolja, hogy a munkatárs a pénzt átvette.
import { formatHuf } from './labels'
import { monthTitle } from './calendar'
import { escHtml } from './payslip'
import { printHtml } from './printWindow'

const ONES = ['', 'egy', 'kettő', 'három', 'négy', 'öt', 'hat', 'hét', 'nyolc', 'kilenc']
const TENS = ['', 'tíz', 'húsz', 'harminc', 'negyven', 'ötven', 'hatvan', 'hetven', 'nyolcvan', 'kilencven']
const TENS_C = ['', 'tizen', 'huszon', 'harminc', 'negyven', 'ötven', 'hatvan', 'hetven', 'nyolcvan', 'kilencven']

// 0–999 betűvel; standalone = ez a szám vége (ott „kettő”, szorzó előtt „két”: kétezer, kétszáz)
function below1000(n: number, standalone: boolean): string {
  const h = Math.floor(n / 100); const t = Math.floor((n % 100) / 10); const o = n % 10
  let s = ''
  if (h) s += (h === 1 ? '' : h === 2 ? 'két' : ONES[h]) + 'száz'
  if (t) s += o ? TENS_C[t] : TENS[t]
  if (o) s += o === 2 && !standalone ? 'két' : ONES[o]
  return s
}

// Összeg betűvel, a magyar helyesírás szerint: kétezerig egybe, fölötte hármas csoportonként
// kötőjellel (pl. 45 000 → negyvenötezer, 125 500 → százhuszonötezer-ötszáz).
export function huNumberWords(value: number): string {
  const n = Math.round(Math.abs(value))
  if (!Number.isFinite(n) || n >= 1_000_000_000) return String(value)
  if (n === 0) return 'nulla'
  const mil = Math.floor(n / 1_000_000); const th = Math.floor((n % 1_000_000) / 1000); const rest = n % 1000
  const parts: string[] = []
  if (mil) parts.push(below1000(mil, false) + 'millió')
  if (th) parts.push((th === 1 ? '' : below1000(th, false)) + 'ezer')
  if (rest) parts.push(below1000(rest, true))
  return parts.join(n > 2000 ? '-' : '')
}

// „Negyvenötezer forint” — nagy kezdőbetűvel, ahogy a bizonylatokon szokás
export function huAmountWords(value: number): string {
  const w = huNumberWords(value)
  return `${w.charAt(0).toUpperCase()}${w.slice(1)} forint`
}

// A bizonylat sorszáma: a kifizetés napjából és a tétel azonosítójából (a tételhez visszakereshető)
export function receiptNumber(id: string, paidOn: string): string {
  return `E-${paidOn.replace(/-/g, '')}-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`
}

// '2026-11-06' → '2026. november 6.'
export function huLongDate(iso: string): string {
  return `${monthTitle(iso.slice(0, 7))} ${Number(iso.slice(8, 10))}.`
}
const shortDay = (iso: string) => `${iso.slice(5, 7)}.${iso.slice(8, 10)}.`

export interface ReceiptData {
  id: string
  company: string // a kifizető (cég) neve
  recipient: string // az átvevő munkatárs
  amount: number
  paidOn: string // a kifizetés napja (YYYY-MM-DD)
  ym: string // melyik hónap elszámolásának terhére megy (YYYY-MM)
  coveredDates: string[] // az előleggel kifizetett napok
  reason: string | null
  paidBy: string | null // aki a pénzt átadta (a tétel rögzítője)
}

function copyHtml(d: ReceiptData, copy: string): string {
  const esc = escHtml
  const row = (k: string, v: string) => `<tr><th>${k}</th><td>${v}</td></tr>`
  return `<section class="copy">
  <div class="head"><div class="company">${esc(d.company.trim() || '—')}</div><div class="no">Sorszám: <strong>${esc(receiptNumber(d.id, d.paidOn))}</strong></div></div>
  <h1>Átvételi elismervény</h1>
  <div class="sub">készpénzben kifizetett előlegről</div>
  <table>
    ${row('Kifizető', esc(d.company.trim() || '—'))}
    ${row('Átvevő', `<strong>${esc(d.recipient)}</strong>`)}
    ${row('Kifizetés napja', esc(huLongDate(d.paidOn)))}
    ${row('Összeg', `<span class="amount">${esc(formatHuf(d.amount))}</span>`)}
    ${row('azaz', esc(huAmountWords(d.amount)))}
    ${row('Jogcím', `Előleg — ${esc(monthTitle(d.ym))} havi elszámolás terhére`)}
    ${d.coveredDates.length ? row(`Fizetett napok (${d.coveredDates.length})`, esc(d.coveredDates.map(shortDay).join(' '))) : ''}
    ${d.reason?.trim() ? row('Megjegyzés', esc(d.reason.trim())) : ''}
  </table>
  <p class="decl">Alulírott átvevő elismerem, hogy a fenti összeget a kifizetés napján készpénzben, hiánytalanul átvettem.</p>
  <div class="sig">
    <div><div class="line"></div>Kifizető (átadó)${d.paidBy ? `<br><span class="who">${esc(d.paidBy)}</span>` : ''}</div>
    <div><div class="line"></div>Átvevő aláírása<br><span class="who">${esc(d.recipient)}</span></div>
  </div>
  <div class="foot">${esc(copy)}</div>
</section>`
}

export function receiptHtml(d: ReceiptData): string {
  const title = `Átvételi elismervény — ${d.recipient} — ${d.paidOn}`
  return `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111; margin: 0; }
  .copy { box-sizing: border-box; height: 132mm; padding: 6mm 8mm; border: 1px solid #111; display: flex; flex-direction: column; }
  .cut { border-top: 1px dashed #777; margin: 4mm 0; text-align: center; font-size: 10px; color: #777; height: 0; }
  .cut span { position: relative; top: -7px; background: #fff; padding: 0 8px; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 13px; }
  .company { font-weight: 800; font-size: 15px; }
  h1 { font-size: 19px; margin: 8px 0 0; text-align: center; letter-spacing: 0.04em; text-transform: uppercase; }
  .sub { text-align: center; font-size: 12px; color: #444; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ddd; font-size: 13px; vertical-align: top; }
  th { width: 34%; font-weight: 600; color: #444; }
  .amount { font-size: 17px; font-weight: 800; }
  .decl { font-size: 12px; margin: 8px 0 0; }
  .sig { margin-top: auto; display: flex; justify-content: space-between; gap: 40px; font-size: 12px; text-align: center; color: #444; }
  .sig > div { flex: 1; }
  .line { border-top: 1px solid #111; margin-bottom: 4px; }
  .who { color: #111; font-weight: 600; }
  .foot { margin-top: 6px; font-size: 10px; color: #777; text-align: right; }
  @media screen { body { margin: 16px; max-width: 190mm; } }
</style></head><body>
${copyHtml(d, '1. példány — a kifizetőé')}
<div class="cut"><span>✂ itt vágd el</span></div>
${copyHtml(d, '2. példány — az átvevőé')}
<script>window.print()</script>
</body></html>`
}

export function openReceipt(d: ReceiptData): void {
  printHtml(receiptHtml(d))
}
