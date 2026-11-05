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
export type PayRole = 'driver' | 'loader' | 'box' | 'trainee' | 'box_trainee'
export const payRoleLabel: Record<PayRole, string> = { driver: 'XL sofőr', loader: 'XL rakodó', box: 'Box sofőr', trainee: 'XL betanuló', box_trainee: 'Box betanuló' }
// rounds: Box sofőrnél hány kört vitt aznap (1 vagy 2) — a 2. körre külön díj jár
// label: a nap összetevői szövegesen (pl. „XL sofőr + Box sofőr (1. kör)”), ha több dolgot csinált
export interface WorkedDay { date: string; role: PayRole; rate: number; rounds?: number; label?: string }
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
  traineeDays: number
  boxDays: number
  boxTraineeDays: number
  boxRound2Days: number
  days: number
  driverRate: number
  loaderRate: number
  traineeRate: number
  boxRate: number
  boxTraineeRate: number
  boxRound2Rate: number
  // A ténylegesen kiszámolt alapbér szerep szerint (a becsekkolás
  // munkaterületének napidíjával) — a napidíj × nap szorzat félrevezető
  // lenne annál, aki több munkaterületen dolgozott
  driverPay: number
  loaderPay: number
  traineePay: number
  boxPay: number
  boxTraineePay: number
  boxRound2Pay: number
  advances: number
  deductions: number
  base: number
  // A bérlapon látható tételek összege (előleg NÉLKÜL) — a bérlap ezzel zár
  earned: number
  // A ténylegesen kifizetendő (a már felvett előleggel csökkentve) — csak adminnak
  total: number
  status: string
  workedDays: WorkedDay[]
  advanceItems: AdjustmentItem[]
  deductionItems: AdjustmentItem[]
}

// A kiválasztott munkatárs adott havi előlegeinek összege — a TELJES havi listából,
// nem a munkaterület utolsó N tételéből (LOG-10: abból kieshettek a tag korábbi tételei)
export function sumAdvances(rows: { type: string; amount: number | string; work_date: string }[], ym: string): number {
  return rows.filter((a) => a.type === 'advance' && a.work_date.startsWith(ym)).reduce((x, a) => x + Number(a.amount), 0)
}

// ---- Napi bér: egy ember egy napjának díja a beosztott szerep(ek)ből ----
// A Bérszámítás ÉS az Előleg-képernyő ugyanezt használja, hogy a „ledolgozott napok
// értéke” mindkét helyen ugyanannyi legyen.
export interface RateSet { driver: number; loader: number; trainee: number; box: number; boxTrainee: number; box2: number }
export interface DayComp { xlDriver: boolean; xlLoader: boolean; boxR1: boolean; boxR2: boolean; xlTrainee: boolean; boxTrainee: boolean }
export interface DayPay {
  rate: number
  role: PayRole
  label: string
  rounds?: number
  // szerepenkénti rész-díjak (null = az a szerep aznap nem volt) — a havi bontáshoz
  driver: number | null
  loader: number | null
  box: number | null
  box2: number | null
  trainee: number | null
  boxTrainee: number | null
}

export interface ShiftLike {
  driver_id: string | null
  loader_id: string | null
  trainee_id: string | null
  work_date: string
  round?: number | null
  car?: unknown
}

// Napi összetevők a beosztásból, kulcs `${userId}|${date}`: egy ember egy napon
// több dolgot is csinálhat (pl. XL sofőr ÉS Box 1. kör) — mindegyik külön díjat kap,
// a nap viszont egy napnak számít
export function buildDayComps(shifts: ShiftLike[]): Map<string, DayComp> {
  const map = new Map<string, DayComp>()
  const compOf = (uid: string, date: string): DayComp => {
    const k = `${uid}|${date}`
    let c = map.get(k)
    if (!c) { c = { xlDriver: false, xlLoader: false, boxR1: false, boxR2: false, xlTrainee: false, boxTrainee: false }; map.set(k, c) }
    return c
  }
  for (const s of shifts) {
    const isBox = !!(s.car as { category: { box_sheet: boolean } | null } | null)?.category?.box_sheet
    if (s.driver_id) { const c = compOf(s.driver_id, s.work_date); if (isBox) { if ((s.round ?? 1) === 2) c.boxR2 = true; else c.boxR1 = true } else c.xlDriver = true }
    if (s.loader_id) compOf(s.loader_id, s.work_date).xlLoader = true
    if (s.trainee_id) { const c = compOf(s.trainee_id, s.work_date); if (isBox) c.boxTrainee = true; else c.xlTrainee = true }
  }
  return map
}

export function payForDay(c: DayComp | undefined, r: RateSet | undefined): DayPay {
  const out: DayPay = { rate: 0, role: 'loader', label: '', driver: null, loader: null, box: null, box2: null, trainee: null, boxTrainee: null }
  const parts: string[] = []
  if (c?.xlDriver) { out.driver = r?.driver ?? 0; out.rate += out.driver; parts.push('XL sofőr'); out.role = 'driver' }
  else if (c?.xlLoader) { out.loader = r?.loader ?? 0; out.rate += out.loader; parts.push('XL rakodó'); out.role = 'loader' }
  if (c?.boxR1 || c?.boxR2) {
    // Box-nap díja jár, ha bármelyik kört vitte; a 2. kör díja RÁADÁS, ha aznap mindkét kört vitte
    out.box = r?.box ?? 0
    out.rate += out.box
    if (c.boxR1 && c.boxR2) { out.box2 = r?.box2 ?? 0; out.rate += out.box2; out.rounds = 2 }
    parts.push(c.boxR1 && c.boxR2 ? 'Box sofőr (2 kör)' : c.boxR2 ? 'Box sofőr (2. kör)' : 'Box sofőr (1. kör)')
    if (out.role !== 'driver') out.role = 'box'
  }
  if (c?.xlTrainee && !c.xlDriver && !c.xlLoader) { out.trainee = r?.trainee ?? 0; out.rate += out.trainee; parts.push('XL betanuló'); if (parts.length === 1) out.role = 'trainee' }
  if (c?.boxTrainee && !c.boxR1 && !c.boxR2) { out.boxTrainee = r?.boxTrainee ?? 0; out.rate += out.boxTrainee; parts.push('Box betanuló'); if (parts.length === 1) out.role = 'box_trainee' }
  if (parts.length === 0) {
    // Ha nincs beosztott szerep aznap (becsekkolt, de nincs beosztva), rakodóként számoljuk (alacsonyabb díj)
    out.loader = r?.loader ?? 0; out.rate += out.loader; parts.push('XL rakodó (beosztás nélkül)'); out.role = 'loader'
  }
  out.label = parts.join(' + ')
  return out
}

type RateCols = {
  driver_day_rate: number | null; loader_day_rate: number | null; trainee_day_rate: number | null
  box_day_rate: number | null; box_trainee_day_rate: number | null; box_round2_day_rate: number | null
}
export function rateSetOf(r: RateCols): RateSet {
  return {
    driver: Number(r.driver_day_rate ?? 0), loader: Number(r.loader_day_rate ?? 0), trainee: Number(r.trainee_day_rate ?? 0),
    box: Number(r.box_day_rate ?? 0), boxTrainee: Number(r.box_trainee_day_rate ?? 0), box2: Number(r.box_round2_day_rate ?? 0),
  }
}

// ---- Előleg: mely ledolgozott napok vannak már kifizetve ----
export interface AdvanceLike { type: string; amount: number | string; covered_dates?: string[] | null }
export interface AdvanceCoverage {
  workedCount: number
  workedValue: number
  // előlegként megjelölt (fizetett) ledolgozott napok
  paidDates: Set<string>
  paidCount: number
  // a hónapban eddig felvett előleg összesen (a nap-megjelölés nélküli régi tételekkel együtt)
  advanced: number
  // még adható előleg: a ledolgozott napok értéke mínusz a már felvett előleg (sosem negatív)
  remaining: number
  // a ledolgozott napok hány százaléka van kifizetve: érték szerint, ha van napidíj; különben napok szerint
  percent: number
}

export function advanceCoverage(worked: { date: string; rate: number }[], adjustments: AdvanceLike[]): AdvanceCoverage {
  const workedDates = new Set(worked.map((w) => w.date))
  const workedValue = worked.reduce((s, w) => s + w.rate, 0)
  const paidDates = new Set<string>()
  let advanced = 0
  for (const a of adjustments) {
    if (a.type !== 'advance') continue
    advanced += Number(a.amount)
    for (const d of a.covered_dates ?? []) if (workedDates.has(d)) paidDates.add(d)
  }
  const workedCount = workedDates.size
  const paidCount = paidDates.size
  const ratio = workedValue > 0 ? advanced / workedValue : workedCount > 0 ? paidCount / workedCount : 0
  return {
    workedCount, workedValue, paidDates, paidCount, advanced,
    remaining: Math.max(0, workedValue - advanced),
    percent: Math.min(100, Math.round(ratio * 100)),
  }
}

// Az új előleg ellenőrzése: legfeljebb a még ki nem fizetett ledolgozott napok értékéig mehet.
// null = rendben; különben a hibaüzenet. Napidíj nélkül (0 Ft érték) nincs mihez mérni — átengedjük.
export function advanceLimitError(amount: number, cov: AdvanceCoverage, fmt: (n: number) => string = String): string | null {
  if (cov.workedCount === 0) return 'Ebben a hónapban még nincs ledolgozott napja — előleg csak ledolgozott napra adható.'
  if (cov.workedValue <= 0) return null
  if (amount > cov.remaining) {
    return cov.remaining <= 0
      ? 'A ledolgozott napjai már teljes egészében ki vannak fizetve előlegként.'
      : `Legfeljebb ${fmt(cov.remaining)} adható: a ledolgozott napok értéke ${fmt(cov.workedValue)}, ebből már felvett ${fmt(cov.advanced)}.`
  }
  return null
}
