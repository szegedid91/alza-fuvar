// QR-kódok nyomtatása választható méretben: egy A4 lapot egyenlő cellákra osztunk
// (1 = egész A4, 2 = fél A4 / A5, 4 = negyed / A6, 8 = nyolcad / A7), minden cellában
// egy autó kódja. A méretek a lap szélességének százalékában (cqw) mennek a stílusba,
// így a képernyős előnézet és a nyomat ugyanaz az arány.

export const A4 = { w: 210, h: 297 } as const // mm, álló

export type QrSizeKey = 'a4' | 'a5' | 'a6' | 'a7'
export interface QrSize { key: QrSizeKey; label: string; sub: string; cols: number; rows: number }

export const QR_SIZES: QrSize[] = [
  { key: 'a4', label: 'A4', sub: 'egész lap · 1 kód / lap', cols: 1, rows: 1 },
  { key: 'a5', label: 'A5', sub: 'fél A4 · 2 kód / lap', cols: 1, rows: 2 },
  { key: 'a6', label: 'A6', sub: 'negyed A4 · 4 kód / lap', cols: 2, rows: 2 },
  { key: 'a7', label: 'A7', sub: 'nyolcad A4 · 8 kód / lap', cols: 2, rows: 4 },
]
export const DEFAULT_QR_SIZE: QrSizeKey = 'a5'

export function qrSizeOf(key: string | null | undefined): QrSize {
  return QR_SIZES.find((s) => s.key === key) ?? QR_SIZES.find((s) => s.key === DEFAULT_QR_SIZE)!
}

export interface QrCellLayout {
  perPage: number
  cellW: number // mm
  cellH: number // mm
  qr: number // a QR-kód oldala, mm
  plateFont: number // a rendszám betűmérete, mm
  textFont: number // a megnevezés / felirat betűmérete, mm
}

// A kód a cella rövidebb irányához igazodik, alatta hely marad a rendszámnak és a feliratnak
export function qrCellLayout(size: QrSize): QrCellLayout {
  const cellW = A4.w / size.cols
  const cellH = A4.h / size.rows
  const qr = Math.round(Math.min(cellW * 0.8, cellH * 0.66) * 10) / 10
  return {
    perPage: size.cols * size.rows, cellW, cellH, qr,
    plateFont: Math.round(qr * 0.15 * 10) / 10,
    textFont: Math.round(Math.max(2.6, qr * 0.05) * 10) / 10,
  }
}

// mm → a lap szélességének százaléka (container query egység)
export const cqw = (mm: number): string => `${Math.round((mm / A4.w) * 10000) / 100}cqw`

export function paginate<T>(items: T[], perPage: number): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage))
  return pages
}
