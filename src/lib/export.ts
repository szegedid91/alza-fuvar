// Sorok exportálása Excel (.xlsx) fájlba. Az xlsx lazy-load.
// Minden szám-cella ezres tagolást kap (egész: 1 234 567; tört: 1 234,50) —
// az Excel a gép nyelvi beállítása szerinti elválasztót mutatja.
export async function exportRowsToXlsx(
  filename: string,
  sheetName: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(rows)
  const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null
  if (range) {
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        if (cell && cell.t === 'n' && typeof cell.v === 'number') cell.z = Number.isInteger(cell.v) ? '#,##0' : '#,##0.00'
      }
    }
    // Oszlopszélesség a fejléc / tartalom hosszához (ne „#####” legyen a nagy szám)
    const keys = rows.length ? Object.keys(rows[0]) : []
    ws['!cols'] = keys.map((k) => ({ wch: Math.min(40, Math.max(k.length, ...rows.map((row) => String(row[k] ?? '').length)) + 2) }))
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  XLSX.writeFile(wb, filename)
}
