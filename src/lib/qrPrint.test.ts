import { describe, it, expect } from 'vitest'
import { QR_SIZES, qrSizeOf, qrCellLayout, paginate, cqw, DEFAULT_QR_SIZE } from './qrPrint'

describe('QR-nyomtatás méretei', () => {
  it('alapértelmezés a fél A4 (A5); ismeretlen kulcs is erre esik vissza', () => {
    expect(DEFAULT_QR_SIZE).toBe('a5')
    expect(qrSizeOf(null).key).toBe('a5')
    expect(qrSizeOf('valami').key).toBe('a5')
    expect(qrSizeOf('a6').key).toBe('a6')
  })
  it('lapra férő darabszám és cellaméret', () => {
    expect(QR_SIZES.map((s) => qrCellLayout(s).perPage)).toEqual([1, 2, 4, 8])
    expect(qrCellLayout(qrSizeOf('a5'))).toMatchObject({ cellW: 210, cellH: 148.5 })
    expect(qrCellLayout(qrSizeOf('a6'))).toMatchObject({ cellW: 105, cellH: 148.5 })
  })
  it('a kód és a feliratok minden méretnél beférnek a cellába', () => {
    for (const s of QR_SIZES) {
      const l = qrCellLayout(s)
      expect(l.qr).toBeLessThanOrEqual(l.cellW * 0.8 + 0.1)
      // kód + rendszám + két sor felirat + térközök
      expect(l.qr + l.plateFont * 1.3 + l.textFont * 1.4 * 2 + l.qr * 0.06).toBeLessThan(l.cellH)
      expect(l.qr).toBeGreaterThan(45) // a legkisebb (A7) is jól olvasható ~5 cm-es kód
    }
    expect(qrCellLayout(qrSizeOf('a5')).qr).toBe(98)
  })
  it('lapokra bontás', () => {
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(paginate([], 4)).toEqual([])
  })
  it('mm → a lap szélességének százaléka', () => {
    expect(cqw(210)).toBe('100cqw')
    expect(cqw(105)).toBe('50cqw')
  })
})
