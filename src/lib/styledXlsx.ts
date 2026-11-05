// Formázott (színes fejléc, szegélyek, rögzített panelek) egylapos Excel-fájl írása.
// Az `xlsx` csomag közösségi kiadása nem ír cellaformázást, ezért a munkafüzet XML-részeit itt
// állítjuk elő, és csak a ZIP-csomagolást bízzuk a csomagra (XLSX.CFB) — új függőség nélkül.

export interface XStyle {
  bold?: boolean
  italic?: boolean
  size?: number
  color?: string // 'RRGGBB'
  fill?: string // 'RRGGBB'
  border?: boolean | 'medium' // szegély körben: vékony (true) vagy közepes fekete ('medium')
  topBorder?: boolean // vastagabb felső szegély (összesítő sor)
  h?: 'left' | 'center' | 'right'
  v?: 'top' | 'center' | 'bottom' // függőleges igazítás (alap: középre)
  wrap?: boolean // sortörés a cellán belül
  numFmt?: string // pl. '0' vagy 'yyyy\\-mm\\-dd'
}
export interface XCell { v?: string | number; f?: string; s?: XStyle }
export interface XSheet {
  name: string
  cells: Record<string, XCell> // 'B2' → cella
  merges?: string[]
  cols?: number[] // oszlopszélességek az A oszloptól
  rowHeights?: Record<number, number>
  freeze?: { cols: number; rows: number } // ennyi oszlop / sor marad rögzítve görgetéskor
  landscape?: boolean
  hideGrid?: boolean
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // XML 1.0-ban tiltott vezérlőkarakterek ki
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
const XMLDECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

export function colToIndex(col: string): number { let n = 0; for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }
export function indexToCol(i: number): string { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
function splitRef(ref: string): { col: number; row: number } {
  const m = ref.match(/^([A-Z]+)(\d+)$/)
  if (!m) throw new Error(`Érvénytelen cellahivatkozás: ${ref}`)
  return { col: colToIndex(m[1]), row: Number(m[2]) }
}

// Stílustábla: az azonos formázások egyszer szerepelnek, a cellák sorszámmal hivatkoznak rájuk
class StyleBook {
  private fonts = ['<font><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/><family val="2"/></font>']
  private fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']
  private borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>']
  private numFmts: string[] = []
  private xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']
  private cache = new Map<string, number>()
  private idx(list: string[], xml: string): number { const i = list.indexOf(xml); return i >= 0 ? i : list.push(xml) - 1 }

  id(s: XStyle | undefined): number {
    if (!s) return 0
    const key = JSON.stringify(s)
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    const font = this.idx(this.fonts, `<font>${s.bold ? '<b/>' : ''}${s.italic ? '<i/>' : ''}<sz val="${s.size ?? 11}"/><color rgb="FF${s.color ?? '1F2937'}"/><name val="Calibri"/><family val="2"/></font>`)
    const fill = s.fill ? this.idx(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0
    const line = '<color rgb="FFCBD5E1"/>'
    const border = s.border === 'medium'
      ? this.idx(this.borders, `<border>${['left', 'right', 'top', 'bottom'].map((side) => `<${side} style="medium"><color rgb="FF000000"/></${side}>`).join('')}<diagonal/></border>`)
      : s.border || s.topBorder
      ? this.idx(this.borders, `<border><left style="thin">${line}</left><right style="thin">${line}</right><top style="${s.topBorder ? 'medium' : 'thin'}">${s.topBorder ? '<color rgb="FF475569"/>' : line}</top><bottom style="thin">${line}</bottom><diagonal/></border>`)
      : 0
    let numFmtId = 0
    if (s.numFmt === '0') numFmtId = 1
    else if (s.numFmt) numFmtId = 164 + this.idx(this.numFmts, s.numFmt)
    const xf = `<xf numFmtId="${numFmtId}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ''} applyFont="1"${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''} applyAlignment="1"><alignment horizontal="${s.h ?? 'left'}" vertical="${s.v ?? 'center'}"${s.wrap ? ' wrapText="1"' : ''}/></xf>`
    const id = this.xfs.push(xf) - 1
    this.cache.set(key, id)
    return id
  }

  xml(): string {
    const numFmts = this.numFmts.length ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : ''
    return `${XMLDECL}<styleSheet xmlns="${NS}">${numFmts}`
      + `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>`
      + `<fills count="${this.fills.length}">${this.fills.join('')}</fills>`
      + `<borders count="${this.borders.length}">${this.borders.join('')}</borders>`
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>`
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '</styleSheet>'
  }
}

// A munkafüzet részei: útvonal → XML (külön tesztelhető; a ZIP-be ebben a sorrendben kerülnek)
export function buildXlsxParts(sheet: XSheet): Record<string, string> {
  const styles = new StyleBook()
  const byRow = new Map<number, { col: number; ref: string; cell: XCell }[]>()
  let maxCol = 0; let maxRow = 1
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const { col, row } = splitRef(ref)
    if (!byRow.has(row)) byRow.set(row, [])
    byRow.get(row)!.push({ col, ref, cell })
    maxCol = Math.max(maxCol, col); maxRow = Math.max(maxRow, row)
  }
  const rowsXml = [...byRow.keys()].sort((a, b) => a - b).map((r) => {
    const cells = byRow.get(r)!.sort((a, b) => a.col - b.col).map(({ ref, cell }) => {
      const s = styles.id(cell.s)
      const sAttr = s ? ` s="${s}"` : ''
      if (cell.f !== undefined) {
        return typeof cell.v === 'number'
          ? `<c r="${ref}"${sAttr}><f>${esc(cell.f)}</f><v>${cell.v}</v></c>`
          : `<c r="${ref}"${sAttr} t="str"><f>${esc(cell.f)}</f><v>${esc(String(cell.v ?? ''))}</v></c>`
      }
      if (typeof cell.v === 'number') return `<c r="${ref}"${sAttr}><v>${cell.v}</v></c>`
      if (typeof cell.v === 'string' && cell.v !== '') return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`
      return `<c r="${ref}"${sAttr}/>`
    }).join('')
    const ht = sheet.rowHeights?.[r]
    return `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells}</row>`
  }).join('')

  const fr = sheet.freeze
  const pane = fr && (fr.cols > 0 || fr.rows > 0)
    ? `<pane${fr.cols > 0 ? ` xSplit="${fr.cols}"` : ''}${fr.rows > 0 ? ` ySplit="${fr.rows}"` : ''} topLeftCell="${indexToCol(fr.cols)}${fr.rows + 1}" activePane="${fr.cols > 0 && fr.rows > 0 ? 'bottomRight' : fr.rows > 0 ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
    : ''
  const cols = sheet.cols?.length ? `<cols>${sheet.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''
  const merges = sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''
  const sheetXml = `${XMLDECL}<worksheet xmlns="${NS}">`
    + (sheet.landscape ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '')
    + `<dimension ref="A1:${indexToCol(maxCol)}${maxRow}"/>`
    + `<sheetViews><sheetView workbookViewId="0"${sheet.hideGrid ? ' showGridLines="0"' : ''}>${pane}</sheetView></sheetViews>`
    + '<sheetFormatPr defaultRowHeight="16"/>'
    + cols
    + `<sheetData>${rowsXml}</sheetData>`
    + merges
    + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
    + (sheet.landscape ? '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' : '')
    + '</worksheet>'

  const PKG = 'http://schemas.openxmlformats.org/package/2006'
  const DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const SS = 'application/vnd.openxmlformats-officedocument.spreadsheetml'
  return {
    '[Content_Types].xml': `${XMLDECL}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="${SS}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${SS}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${SS}.styles+xml"/></Types>`,
    '_rels/.rels': `${XMLDECL}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${DOC}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${XMLDECL}<workbook xmlns="${NS}" xmlns:r="${DOC}"><sheets><sheet name="${esc(sheet.name.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="0" fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XMLDECL}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${DOC}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${DOC}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': styles.xml(),
    'xl/worksheets/sheet1.xml': sheetXml,
  }
}

// A részek ZIP-be csomagolva (xlsx fájl tartalma)
export async function buildXlsxBytes(sheet: XSheet): Promise<Uint8Array> {
  const XLSX = await import('xlsx')
  const zip = XLSX.CFB.utils.cfb_new()
  const enc = new TextEncoder()
  for (const [path, xml] of Object.entries(buildXlsxParts(sheet))) XLSX.CFB.utils.cfb_add(zip, `/${path}`, enc.encode(xml))
  const out = XLSX.CFB.write(zip, { fileType: 'zip', type: 'array', compression: true }) as unknown as ArrayLike<number>
  return out instanceof Uint8Array ? out : new Uint8Array(out)
}

export async function downloadStyledXlsx(sheet: XSheet, filename: string): Promise<void> {
  const bytes = await buildXlsxBytes(sheet)
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
