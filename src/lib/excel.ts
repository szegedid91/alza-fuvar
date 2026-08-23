import { parseHuNumber } from './labels'

export interface ParsedStop {
  sheet_name: string
  seq: number | null
  street: string | null
  postal_code: string | null
  city: string | null
  cod_amount: number | null
  payment_method: string | null
  time_window: string | null
  planned_time: string | null
  note: string | null
  weight: number | null
  phone: string | null
  is_cash: boolean
  expected_amount: number | null
}

// Készpénzes fizetési módok
const CASH_METHODS = ['keszpenz', 'dobirkou']

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v
  // Európai formátumok ("1.234,56", "1 234", "1,5") helyes kezelése
  const n = parseHuNumber(String(v))
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// Oszlopnév -> kulcs illesztés (ékezet/szóköz tűrő)
const COLMAP: Record<string, keyof ParsedStop> = {
  utca: 'street',
  cim: 'street',
  iranyitoszam: 'postal_code',
  irsz: 'postal_code',
  varos: 'city',
  telepules: 'city',
  utanvet: 'cod_amount',
  fizetesimod: 'payment_method',
  idosav: 'time_window',
  tervezettkezbesitesiido: 'planned_time',
  tervezettido: 'planned_time',
  megjegyzes: 'note',
  tomeg: 'weight',
  rendeles: 'seq',
  sorrend: 'seq',
  telefon: 'phone',
  telefonszam: 'phone',
}

function isCash(method: string | null): boolean {
  if (!method) return false
  return CASH_METHODS.includes(norm(method))
}

// Excel fájl -> stopok (több munkalap: XL / RPL / AB ...)
export async function parseRouteExcel(file: File): Promise<ParsedStop[]> {
  const XLSX = await import('xlsx') // lazy-load: csak importáláskor töltődik
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const out: ParsedStop[] = []

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
    let autoSeq = 0
    for (const row of rows) {
      // fejléc -> kulcs
      const mapped: Partial<Record<keyof ParsedStop, unknown>> = {}
      for (const [header, value] of Object.entries(row)) {
        const key = COLMAP[norm(header)]
        if (key) mapped[key] = value
      }
      // üres sor kihagyása
      if (!mapped.street && !mapped.city && !mapped.postal_code) continue
      autoSeq += 1
      const payment_method = str(mapped.payment_method)
      const cod_amount = num(mapped.cod_amount)
      const cash = isCash(payment_method)
      out.push({
        sheet_name: sheetName,
        seq: num(mapped.seq) ?? autoSeq,
        street: str(mapped.street),
        postal_code: str(mapped.postal_code),
        city: str(mapped.city),
        cod_amount,
        payment_method,
        time_window: str(mapped.time_window),
        planned_time: str(mapped.planned_time),
        note: str(mapped.note),
        weight: num(mapped.weight),
        phone: str(mapped.phone),
        is_cash: cash,
        expected_amount: cash ? cod_amount ?? 0 : 0,
      })
    }
  }
  return out
}
