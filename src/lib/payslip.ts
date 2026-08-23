import type { PayrollRow } from './payroll'

const HUF = (n: number) => new Intl.NumberFormat('hu-HU', { style: 'currency', currency: 'HUF', maximumFractionDigits: 0 }).format(n)

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
  .foot { margin-top: 40px; font-size: 12px; color: #888; }
  .sig { margin-top: 60px; display: flex; justify-content: space-between; gap: 40px; }
  .sig div { flex: 1; border-top: 1px solid #111; padding-top: 6px; font-size: 12px; text-align: center; color: #444; }
  @media print { body { margin: 20px; } }
</style></head><body>
  <h1>Bérlap — ${ym}</h1>
  <div class="muted">${esc(row.workspace)} · ${esc(row.name)}</div>
  <table>
    <tr><th>Tétel</th><th>Mennyiség</th><th>Összeg</th></tr>
    <tr><td>Sofőr napok</td><td>${row.driverDays} nap × ${HUF(row.driverRate)}</td><td>${HUF(row.driverDays * row.driverRate)}</td></tr>
    <tr><td>Rakodó napok</td><td>${row.loaderDays} nap × ${HUF(row.loaderRate)}</td><td>${HUF(row.loaderDays * row.loaderRate)}</td></tr>
    <tr><td>Alapbér összesen</td><td>${row.days} ledolgozott nap</td><td>${HUF(row.base)}</td></tr>
    <tr><td>Borravaló</td><td></td><td class="pos">+${HUF(row.tips)}</td></tr>
    ${row.shortfall > 0 ? `<tr><td>Készpénz-hiány</td><td></td><td class="neg">−${HUF(row.shortfall)}</td></tr>` : ''}
    <tr><td>Előleg</td><td></td><td class="neg">−${HUF(row.advances)}</td></tr>
    <tr><td>Levonás</td><td></td><td class="neg">−${HUF(row.deductions)}</td></tr>
    <tr class="total"><td>Fizetendő</td><td></td><td>${HUF(row.total)}</td></tr>
  </table>
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
