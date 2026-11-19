// Diagram-segédek: kerek tengelyosztás és tömör számformázás

// Kerek felső határ és osztások 0-tól a legnagyobb értékig (kb. `target` osztással)
export function niceTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1]
  const raw = max / target
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow
  const ticks: number[] = []
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}

// Tömör forint a tengelyre: 0 / 50 e / 1,2 M
export function compactHuf(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toLocaleString('hu-HU', { maximumFractionDigits: 1 })} M`
  if (a >= 1_000) return `${Math.round(n / 1_000).toLocaleString('hu-HU')} e`
  return String(Math.round(n))
}

const MONTH_SHORT = ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.']
// 'YYYY-MM' → 'nov.' (januárnál az évvel: '2027 jan.')
export function monthShort(ym: string, withYear = false): string {
  const m = Number(ym.slice(5, 7))
  const s = MONTH_SHORT[m - 1] ?? ym
  return withYear || m === 1 ? `${ym.slice(0, 4)} ${s}` : s
}
// 'YYYY-MM-DD' → '11.03.'
export const dayShort = (iso: string): string => `${iso.slice(5, 7)}.${iso.slice(8, 10)}.`
