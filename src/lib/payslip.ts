import type { PayrollRow } from './payroll'

const HUF = (n: number) => new Intl.NumberFormat('hu-HU', { style: 'currency', currency: 'HUF', maximumFractionDigits: 0 }).format(n)

const WEEKDAY = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat']

// 'YYYY-MM-DD' → '07.01. hétfő' — helyi naptári napként értelmezve (nem UTC)
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const wd = WEEKDAY[new Date(y, m - 1, d).getDay()]
  return `${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}. ${wd}`
}

// Nyomtatható bérlap külön ablakban — a böngésző "Mentés PDF-ként" opciójával
// lesz belőle PDF. Szándékosan függőség-mentes (nincs jsPDF).
export function openPayslip(row: PayrollRow, ym: string): void {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><title>Bérlap — ${esc(row.name)} — ${ym}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111; margin: 40px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #666; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  td, th { padding: 8px 10px; border-bottom: 1px solid #ddd; font-size: 14px; text-align: left; }
  td:last-child, th:last-child { text-align: right; }
  .total td { font-weight: 800; font-size: 16px; border-top: 2px solid #111; border-bottom: none; }
  .neg { color: #b00020; }
  .pos { color: #0a7d33; }
  h2 { font-size: 14px; margin: 26px 0 4px; }
  .days { columns: 2; column-gap: 32px; margin-top: 6px; }
  .dayrow { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 3px 0; border-bottom: 1px solid #eee; break-inside: avoid; }
  .detail td, .detail th { font-size: 12px; padding: 5px 8px; }
  .none { font-size: 12px; color: #888; margin: 4px 0 0; }
  .foot { margin-top: 40px; font-size: 12px; color: #888; }
  .sig { margin-top: 60px; display: flex; justify-content: space-between; gap: 40px; }
  .sig div { flex: 1; border-top: 1px solid #111; padding-top: 6px; font-size: 12px; text-align: center; color: #444; }
  @media print { body { margin: 20px; } }
</style></head><body>
  <h1>Bérlap — ${ym}</h1>
  <div class="muted">${esc(row.workspace)} · ${esc(row.name)}</div>
  <table>
    <tr><th>Tétel</th><th>Mennyiség</th><th>Összeg</th></tr>
    <tr><td>Sofőr napok</td><td>${row.driverDays} nap</td><td>${HUF(row.driverPay)}</td></tr>
    <tr><td>Rakodó napok</td><td>${row.loaderDays} nap</td><td>${HUF(row.loaderPay)}</td></tr>
    <tr><td>Alapbér összesen</td><td>${row.days} ledolgozott nap</td><td>${HUF(row.base)}</td></tr>
    <tr><td>Borravaló</td><td></td><td class="pos">+${HUF(row.tips)}</td></tr>
    ${row.shortfall > 0 ? `<tr><td>Készpénz-hiány</td><td></td><td class="neg">−${HUF(row.shortfall)}</td></tr>` : ''}
    <tr><td>Levonás</td><td></td><td class="neg">−${HUF(row.deductions)}</td></tr>
    <tr class="total"><td>Járandóság összesen</td><td></td><td>${HUF(row.earned)}</td></tr>
  </table>
  <p class="none">A hónap közben már felvett előleg a kifizetéskor kerül elszámolásra.</p>

  <h2>Ledolgozott napok (${row.workedDays.length})</h2>
  ${row.workedDays.length === 0 ? '<p class="none">Nem volt ledolgozott nap ebben a hónapban.</p>' : `
  <div class="days">
    ${row.workedDays.map((w) => `<div class="dayrow"><span>${fmtDay(w.date)}</span><span>${w.role === 'driver' ? 'Sofőr' : 'Rakodó'} · ${HUF(w.rate)}</span></div>`).join('')}
  </div>`}

  <h2>Levonások</h2>
  ${row.deductionItems.length === 0 ? '<p class="none">Nem volt levonás ebben a hónapban.</p>' : `
  <table class="detail">
    <tr><th>Dátum</th><th>Indok</th><th>Összeg</th></tr>
    ${row.deductionItems.map((a) => `<tr><td>${fmtDay(a.date)}</td><td>${a.reason ? esc(a.reason) : '—'}</td><td class="neg">−${HUF(a.amount)}</td></tr>`).join('')}
  </table>`}

  <div class="sig"><div>Munkáltató</div><div>Munkavállaló</div></div>
  <div class="foot">Készült: ${new Date().toLocaleString('hu-HU')} · Alza Fuvarszervező</div>
  <script>window.print()</script>
</body></html>`
  const w = window.open('', '_blank')
  if (w) {
    w.document.write(html)
    w.document.close()
    return
  }
  // Fallback: ha a felugró ablak tiltott, rejtett iframe-ből nyomtatunk
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const doc = frame.contentWindow?.document
  if (!doc) { frame.remove(); return }
  doc.open()
  doc.write(html.replace('<script>window.print()</script>', ''))
  doc.close()
  frame.contentWindow?.focus()
  frame.contentWindow?.print()
  setTimeout(() => frame.remove(), 60000)
}
