// Hónap-tartomány segédek + bérszámítás típusok
import { todayISO } from './labels'

export function monthRange(ym: string): { start: string; endExclusive: string; startISO: string; endISO: string } {
  // ym = 'YYYY-MM'
  const [y, m] = ym.split('-').map(Number)
  const start = `${ym}-01`
  const nextM = m === 12 ? 1 : m + 1
  const nextY = m === 12 ? y + 1 : y
  const endExclusive = `${nextY}-${String(nextM).padStart(2, '0')}-01`
  // A timestamptz-szűrőknek (recorded_at) a HELYI hónapkezdet UTC-pillanata kell,
  // különben a hó végi éjszakai rögzítések rossz hónapba esnek.
  const startISO = new Date(y, m - 1, 1).toISOString()
  const endISO = new Date(nextY, nextM - 1, 1).toISOString()
  return { start, endExclusive, startISO, endISO }
}

export function currentYm(): string {
  // Helyi naptár szerint (a toISOString() UTC-je hó 1-jén hajnalban még előző hónapot adna)
  return todayISO().slice(0, 7)
}

// Napi részletek a bérlaphoz: mikor dolgozott és milyen szerepben,
// mikor kapott előleget, és mi a levonás indoka.
export interface WorkedDay { date: string; role: 'driver' | 'loader'; rate: number }
export interface AdjustmentItem { date: string; amount: number; reason: string | null }

// Csapat-szintű, szerep szerinti napidíjak: a bér a napi beosztott szerep
// (sofőr/rakodó) szerint áll össze. A ledolgozott napok a becsekkolásból,
// a napi szerep a beosztásból (shift) származik.
export interface PayrollRow {
  userId: string
  name: string
  workspace: string
  workspaceId: string | null
  driverDays: number
  loaderDays: number
  days: number
  driverRate: number
  loaderRate: number
  tips: number // csak a pozitív borravalók összege
  shortfall: number // készpénz-hiányok összege (pozitív számként)
  advances: number
  deductions: number
  base: number
  total: number
  workedDays: WorkedDay[]
  advanceItems: AdjustmentItem[]
  deductionItems: AdjustmentItem[]
}
