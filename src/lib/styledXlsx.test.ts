// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { buildXlsxParts, buildXlsxBytes, colToIndex, indexToCol, type XSheet } from './styledXlsx'
import { buildRoundsTable, roundsStyledSheet, type RoundShift } from './roundsExport'

const parse = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('hibás XML: ' + doc.querySelector('parsererror')!.textContent)
  return doc
}
const sample: XSheet = {
  name: 'Teszt & <lap>',
  cells: {
    B2: { v: 'Fejléc "idézet" & <jel>', s: { bold: true, fill: '0F766E', color: 'FFFFFF', border: true, h: 'center' } },
    C2: { s: { bold: true, fill: '0F766E', color: 'FFFFFF', border: true, h: 'center' } },
    B3: { v: 46296, s: { numFmt: 'yyyy\\-mm\\-dd', border: true } },
    C3: { v: 2, s: { numFmt: '0', border: true, h: 'center' } },
    D3: { v: 3, f: 'SUM(C3,C3)+1', s: { bold: true } },
    E3: { v: '', f: 'IF(C3=0,"",C3)' },
  },
  merges: ['B2:C2'], cols: [2, 20, 8], rowHeights: { 2: 22 }, freeze: { cols: 2, rows: 2 }, landscape: true, hideGrid: true,
}

describe('styledXlsx — formázott munkafüzet részei', () => {
  const parts = buildXlsxParts(sample)
  it('minden rész jól formált XML, a kötelező részek megvannak', () => {
    expect(Object.keys(parts)).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml'])
    for (const xml of Object.values(parts)) parse(xml)
    expect(parse(parts['xl/workbook.xml']).querySelector('sheet')!.getAttribute('name')).toBe('Teszt & <lap>')
  })
  it('cellák: szöveg escape-elve, szám, képlet az értékével, üres formázott cella', () => {
    const doc = parse(parts['xl/worksheets/sheet1.xml'])
    const c = (r: string) => doc.querySelector(`c[r="${r}"]`)!
    expect(c('B2').getAttribute('t')).toBe('inlineStr'); expect(c('B2').textContent).toBe('Fejléc "idézet" & <jel>')
    expect(c('C2').children.length).toBe(0); expect(c('C2').getAttribute('s')).toBe(c('B2').getAttribute('s'))
    expect(c('C3').querySelector('v')!.textContent).toBe('2')
    expect(c('D3').querySelector('f')!.textContent).toBe('SUM(C3,C3)+1'); expect(c('D3').querySelector('v')!.textContent).toBe('3')
    expect(c('E3').getAttribute('t')).toBe('str')
    expect(doc.querySelector('mergeCell')!.getAttribute('ref')).toBe('B2:C2')
    expect(doc.querySelector('pane')!.getAttribute('topLeftCell')).toBe('C3')
    expect(doc.querySelector('sheetView')!.getAttribute('showGridLines')).toBe('0')
    expect(doc.querySelector('row[r="2"]')!.getAttribute('ht')).toBe('22')
  })
  it('stílusok: azonos formázás egyszer, a hivatkozott sorszámok léteznek', () => {
    const st = parse(parts['xl/styles.xml'])
    const xfs = st.querySelectorAll('cellXfs > xf')
    expect(Number(st.querySelector('cellXfs')!.getAttribute('count'))).toBe(xfs.length)
    expect(xfs.length).toBe(5) // alap + fejléc + dátum + egész + félkövér
    const sheet = parse(parts['xl/worksheets/sheet1.xml'])
    for (const c of sheet.querySelectorAll('c[s]')) expect(Number(c.getAttribute('s'))).toBeLessThan(xfs.length)
    const head = xfs[Number(sheet.querySelector('c[r="B2"]')!.getAttribute('s'))]
    expect(st.querySelectorAll('fills > fill')[Number(head.getAttribute('fillId'))].querySelector('fgColor')!.getAttribute('rgb')).toBe('FF0F766E')
    expect(st.querySelector('numFmt')!.getAttribute('formatCode')).toBe('yyyy\\-mm\\-dd')
  })
  it('oszlopnév ↔ sorszám', () => {
    expect([0, 25, 26, 65].map(indexToCol)).toEqual(['A', 'Z', 'AA', 'BN'])
    expect(colToIndex('BN')).toBe(65)
  })
})

describe('járatszám-tábla formázva — visszaolvasható Excel-fájl', () => {
  const routes = ['G', 'I', 'R'].map((c) => ({ id: c, code: c, active: true, is_relief: false }))
  const shifts: RoundShift[] = [
    { work_date: '2026-10-20', route_id: 'G', round: 1, staffed: true, isBox: true },
    { work_date: '2026-10-20', route_id: 'G', round: 2, staffed: true, isBox: true },
    { work_date: '2026-10-24', route_id: 'I', round: 1, staffed: true, isBox: true }, // szombat
  ]
  const sheet = roundsStyledSheet(buildRoundsTable('2026-10', routes, shifts, 'Budapest'), 'Alza — napi járatszám · 2026. október')
  it('a tábla minden cellája kap formázást (az üres napok is), a hétvége árnyalt, a 0 halvány', () => {
    expect(sheet.cells.B1.v).toBe('Alza — napi járatszám · 2026. október')
    expect(sheet.cells.C4.s?.border).toBe(true); expect(sheet.cells.C4.v).toBeUndefined() // üres nap: szegély, érték nélkül
    expect(sheet.cells.AO4).toMatchObject({ v: 1, s: { bold: true } })
    expect(sheet.cells.AO5).toMatchObject({ v: 0, s: { color: '94A3B8' } })
    expect(sheet.cells.AW5.s?.fill).toBe('F1F5F9') // 10-24 szombat
    expect(sheet.cells.AW2.s?.fill).toBe('475569'); expect(sheet.cells.AO2.s?.fill).toBe('0F766E')
    expect(sheet.cells.BM4.s?.fill).toBe('FEF3C7')
    expect(sheet.freeze).toEqual({ cols: 2, rows: 3 })
  })
  it('a kész fájl megnyitható: értékek, képletek, összevonások, dátumformátum a helyén', async () => {
    const wb = XLSX.read(await buildXlsxBytes(sheet), { cellNF: true, cellFormula: true })
    expect(wb.SheetNames).toEqual(['Alapadat táblák'])
    const ws = wb.Sheets['Alapadat táblák']
    expect(ws.B2.v).toBe('Db'); expect(ws.B4.v).toBe('Budapest G')
    expect(ws.C2.v).toBe(46296); expect(ws.C2.z).toBe('yyyy\\-mm\\-dd'); expect(ws.C2.w).toBe('2026-10-01')
    expect(ws.AO4.v).toBe(1); expect(ws.AP4.v).toBe(1); expect(ws.AO5.v).toBe(0)
    expect(ws.BM4.f).toMatch(/^SUM\(C4,E4,/); expect(ws.BM4.v).toBe(1)
    expect(ws.AO7.f).toBe('IF(SUM(AO4:AO6)=0,"",SUM(AO4:AO6))'); expect(ws.BM7.v).toBe(2); expect(ws.BN7.v).toBe(1)
    expect(ws['!merges']).toHaveLength(32)
    expect(ws['!ref']).toBe('A1:BN9')
  })
})
