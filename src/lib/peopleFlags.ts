// Figyelmeztető jelek a munkatársak listáján: kinél van olyan eltérés, amire a vezetőnek rá kell néznie.
// A küszöbök egy helyen vannak, hogy könnyű legyen hangolni.
export interface AbsenceLike { from_date: string; to_date: string }
export const coversDate = (a: AbsenceLike, date: string): boolean => a.from_date <= date && date <= a.to_date
// Az igazolt távollét (szabadság, betegség) napjai nem számítanak kimaradt napnak
export const unexcused = (missed: string[], absences: AbsenceLike[]): string[] => missed.filter((d) => !absences.some((a) => coversDate(a, d)))

export interface PersonSignals {
  missed: number        // beosztva volt, de nem csekkolt be (igazolt távollét nélkül)
  lateDepartures: number // késve indult (5 perc felett)
  stops: number; lateStops: number
  alarms: number        // „Nem indult el” riasztás
  notParked: number     // este nem rakta le az autót
  waived: number        // ellenőrző fotó nélkül továbbengedve
  warnings: number; complaints: number
}
export interface PersonFlag { level: 'red' | 'yellow' | null; reasons: string[]; score: number }

export function flagOf(s: PersonSignals): PersonFlag {
  const red: string[] = [], yellow: string[] = []
  if (s.missed >= 2) red.push(`${s.missed} kimaradt nap`); else if (s.missed === 1) yellow.push('1 kimaradt nap')
  if (s.lateDepartures >= 3) red.push(`${s.lateDepartures} késett indulás`); else if (s.lateDepartures >= 1) yellow.push(`${s.lateDepartures} késett indulás`)
  if (s.alarms >= 1) red.push(`${s.alarms} „nem indult el” riasztás`)
  if (s.complaints >= 1) red.push(`${s.complaints} megbízói panasz`)
  const latePct = s.stops >= 10 ? Math.round((s.lateStops / s.stops) * 100) : 0
  if (latePct >= 20) yellow.push(`a megállók ${latePct}%-a késett`)
  if (s.notParked >= 1) yellow.push(`${s.notParked} napon nem rakta le az autót`)
  if (s.waived >= 1) yellow.push(`${s.waived} nap ellenőrző fotó nélkül`)
  if (s.warnings >= 1) yellow.push(`${s.warnings} figyelmeztetés`)
  // a pontszám a sorrendhez: egy piros ok többet nyom, mint bármennyi sárga
  return { level: red.length ? 'red' : yellow.length ? 'yellow' : null, reasons: [...red, ...yellow], score: red.length * 100 + yellow.length }
}
