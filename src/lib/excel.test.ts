import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseRouteExcel } from './excel'

// Excel fájl összeállítása memóriában — ugyanazt a parsert hívjuk, mint az app
function makeFile(sheets: Record<string, Record<string, unknown>[]>): File {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name)
  }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([buf], 'fuvarterv.xlsx')
}

describe('parseRouteExcel', () => {
  it('fejlécek ékezet/szóköz nélkül is illeszkednek, több munkalap', async () => {
    const file = makeFile({
      XL: [
        { 'Utca': 'Fő utca 1.', 'Irányítószám': '1011', 'Város': 'Budapest', 'Utánvét': '12 500', 'Fizetési mód': 'Készpénz', 'Idősáv': '8-10', 'Telefon': '+36301234567' },
        { 'Utca': 'Kis köz 2.', 'Irányítószám': '1012', 'Város': 'Budapest', 'Utánvét': 5000, 'Fizetési mód': 'Kártya' },
      ],
      RPL: [
        { 'utca': 'Nagy út 3.', 'varos': 'Érd', 'fizetesimod': 'dobírkou', 'utanvet': '1.234,5' },
      ],
    })
    const stops = await parseRouteExcel(file)
    expect(stops).toHaveLength(3)

    expect(stops[0]).toMatchObject({
      sheet_name: 'XL', seq: 1, street: 'Fő utca 1.', postal_code: '1011', city: 'Budapest',
      cod_amount: 12500, is_cash: true, expected_amount: 12500, time_window: '8-10', phone: '+36301234567',
    })
    // kártyás: nem készpénz → nincs várt beszedés
    expect(stops[1]).toMatchObject({ seq: 2, cod_amount: 5000, is_cash: false, expected_amount: 0 })
    // másik munkalap, "dobírkou" is készpénz, európai számformátum
    expect(stops[2]).toMatchObject({ sheet_name: 'RPL', seq: 1, city: 'Érd', cod_amount: 1234.5, is_cash: true, expected_amount: 1234.5 })
  })

  it('üres sorokat kihagy, a sorrend oszlop felülírja az automatikus sorszámot', async () => {
    const file = makeFile({
      AB: [
        { 'Utca': null, 'Város': null },
        { 'Utca': 'X u. 1.', 'Város': 'Pécs', 'Sorrend': 7 },
      ],
    })
    const stops = await parseRouteExcel(file)
    expect(stops).toHaveLength(1)
    expect(stops[0].seq).toBe(7)
    expect(stops[0].is_cash).toBe(false)
  })
})
