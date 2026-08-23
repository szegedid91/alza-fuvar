// Sorok exportálása Excel (.xlsx) fájlba. Az xlsx lazy-load.
export async function exportRowsToXlsx(
  filename: string,
  sheetName: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  XLSX.writeFile(wb, filename)
}
