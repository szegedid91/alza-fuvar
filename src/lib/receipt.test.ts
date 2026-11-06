import { describe, expect, it } from 'vitest'
import { huAmountWords, huLongDate, huNumberWords, receiptHtml, receiptNumber, type ReceiptData } from './receipt'

describe('huNumberWords — összeg betűvel', () => {
  const cases: [number, string][] = [
    [0, 'nulla'], [1, 'egy'], [2, 'kettő'], [10, 'tíz'], [12, 'tizenkettő'], [20, 'húsz'], [21, 'huszonegy'], [22, 'huszonkettő'],
    [100, 'száz'], [101, 'százegy'], [200, 'kétszáz'], [999, 'kilencszázkilencvenkilenc'],
    [1000, 'ezer'], [1500, 'ezerötszáz'], [2000, 'kétezer'], [2001, 'kétezer-egy'],
    [5000, 'ötezer'], [10000, 'tízezer'], [20000, 'húszezer'], [22000, 'huszonkétezer'], [25000, 'huszonötezer'], [45000, 'negyvenötezer'],
    [100000, 'százezer'], [125500, 'százhuszonötezer-ötszáz'], [565000, 'ötszázhatvanötezer'],
    [1000000, 'egymillió'], [1200000, 'egymillió-kétszázezer'], [2000002, 'kétmillió-kettő'],
  ]
  it.each(cases)('%d → %s', (n, w) => { expect(huNumberWords(n)).toBe(w) })
  it('kerekít, és nagy kezdőbetűvel adja a forintot', () => {
    expect(huNumberWords(4999.6)).toBe('ötezer')
    expect(huAmountWords(45000)).toBe('Negyvenötezer forint')
    expect(huAmountWords(1)).toBe('Egy forint')
  })
})

describe('bizonylat', () => {
  const d: ReceiptData = {
    id: '3f2a9c1e-0000-4000-8000-000000000000', company: 'Utód zrt.', recipient: 'Nagy <Gábor>', amount: 45000,
    paidOn: '2026-11-06', ym: '2026-10', coveredDates: ['2026-10-03', '2026-10-04'], reason: 'készpénz & átvétel', paidBy: 'Szegedi Dániel',
  }
  it('sorszám és dátum', () => {
    expect(receiptNumber(d.id, d.paidOn)).toBe('E-20261106-3F2A')
    expect(huLongDate('2026-11-06')).toBe('2026. november 6.')
  })
  it('két példány, a kifizetés napjával, az összeggel számmal és betűvel', () => {
    const html = receiptHtml(d)
    expect(html.match(/<section class="copy">/g)).toHaveLength(2)
    expect(html).toContain('1. példány — a kifizetőé')
    expect(html).toContain('2. példány — az átvevőé')
    expect(html).toContain('2026. november 6.')
    expect(html).toContain('Negyvenötezer forint')
    expect(html).toContain('E-20261106-3F2A')
    expect(html).toContain('Előleg — 2026. október havi elszámolás terhére')
    expect(html).toContain('Fizetett napok (2)')
    expect(html).toContain('10.03. 10.04.')
    expect(html).toContain('Szegedi Dániel')
  })
  it('a nevek és a megjegyzés HTML-ként nem értelmeződnek', () => {
    const html = receiptHtml(d)
    expect(html).toContain('Nagy &lt;Gábor&gt;')
    expect(html).not.toContain('<Gábor>')
    expect(html).toContain('készpénz &amp; átvétel')
  })
  it('fizetett nap és megjegyzés nélkül ezek a sorok kimaradnak', () => {
    const html = receiptHtml({ ...d, coveredDates: [], reason: null, paidBy: null })
    expect(html).not.toContain('Fizetett napok')
    expect(html).not.toContain('Megjegyzés')
  })
})
