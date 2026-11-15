// MUNKANAP — nem a naptári nap. Az éjszakai (1.) kör este indul, a 2. kör másnap reggel, és MINDKETTŐ a
// reggel napjához tartozik: ha hétfő este kezd az 1. kör és kedd reggel indul a 2., a két kör KEDDI beosztás.
// Ezért a munkanap este 18:00-kor vált a következő napra.
//
// Kiegészítés (rögzítés): amíg a futárnak NYITOTT becsekkolása van, a munkanapja az a nap marad, amire
// becsekkolt — így egy este 6 után még dolgozó nappalos futár napja sem „tűnik el” menet közben, és éjfélkor
// sem vált semmi. A rögzítés a telefonon él (legfeljebb 20 óráig), és az autó lerakásával megszűnik.
import { localISODate } from './labels'

export const WORKDAY_CUTOVER_HOUR = 18

// A váltás szerinti munkanap (rögzítés nélkül): 18:00-tól már a holnapi nap
export function operationalDayISO(now: Date = new Date()): string {
  return localISODate(new Date(now.getTime() + (24 - WORKDAY_CUTOVER_HOUR) * 3_600_000))
}
// A váltás után vagyunk-e (18:00–23:59): ilyenkor a munkanap a naptári holnap
export function isAfterCutover(now: Date = new Date()): boolean {
  return now.getHours() >= WORKDAY_CUTOVER_HOUR
}
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return localISODate(d)
}

// ── Rögzítés a nyitott becsekkoláshoz ──────────────────────────────────────────────────────
const PIN_KEY = 'alza-workday-pin'
const PIN_MAX_MS = 20 * 3_600_000
interface Pin { date: string; userId: string; at: number }

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
let cutoverTimer: ReturnType<typeof setTimeout> | null = null
function armCutoverTimer() {
  if (cutoverTimer || typeof window === 'undefined') return
  const now = new Date()
  const next = new Date(now); next.setHours(WORKDAY_CUTOVER_HOUR, 0, 1, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  cutoverTimer = setTimeout(() => { cutoverTimer = null; notify(); armCutoverTimer() }, Math.min(next.getTime() - now.getTime(), 2_000_000_000))
}
export function subscribeWorkDay(l: () => void): () => void {
  listeners.add(l); armCutoverTimer()
  return () => { listeners.delete(l) }
}

function readPin(now: number = Date.now()): Pin | null {
  try {
    const raw = localStorage.getItem(PIN_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<Pin>
    if (!p || typeof p.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || typeof p.at !== 'number') return null
    if (now - p.at > PIN_MAX_MS || now - p.at < -60_000) return null
    return { date: p.date, userId: String(p.userId ?? ''), at: p.at }
  } catch { return null }
}
export function pinnedWorkDay(): string | null { return readPin()?.date ?? null }
export function pinWorkDay(date: string, userId: string) {
  const cur = readPin()
  if (cur && cur.date === date && cur.userId === userId) return // már rögzítve — az időbélyeg az ELSŐ rögzítésé marad
  try { localStorage.setItem(PIN_KEY, JSON.stringify({ date, userId, at: Date.now() } satisfies Pin)) } catch { /* privát mód: marad a váltás szerinti nap */ }
  notify()
}
export function clearWorkDayPin() {
  let had = false
  try { had = localStorage.getItem(PIN_KEY) != null; localStorage.removeItem(PIN_KEY) } catch { /* nem kritikus */ }
  if (had) notify()
}

// A futár AKTUÁLIS munkanapja: a nyitott becsekkoláshoz rögzített nap, különben a váltás szerinti
export function workDayISO(now: Date = new Date()): string {
  return readPin(now.getTime())?.date ?? operationalDayISO(now)
}
