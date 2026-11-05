// „Nem indult el a munkába” riasztás — vezetőnként beállítható szabályok (setoff_alert_rules).
// A szerver percenként nézi: a határidő (budapesti idő) percében az kap értesítést, akié a szabály,
// azokról az aznapra beosztott munkatársakról, akik addig nem nyomták meg az „Elindultam a munkába”
// gombot (és be sem csekkoltak).

export type AlertScope = 'all' | 'xl' | 'box1' | 'box2'

export interface SetOffAlertRule {
  id: string
  deadline: string // 'HH:MM' vagy 'HH:MM:SS'
  scope: AlertScope
  loud: boolean
  enabled: boolean
  call: boolean // hangos szabálynál: telefonhívás is, ha a riasztást nem nyitják meg
}

export const ALERT_SCOPES: { key: AlertScope; label: string }[] = [
  { key: 'all', label: 'Mindenki, aki aznap be van osztva' },
  { key: 'xl', label: 'XL autók brigádjai' },
  { key: 'box1', label: 'Box 1. kör (DPO, éjszakai)' },
  { key: 'box2', label: 'Box 2. kör (SD, hajnali)' },
]
export const MAX_ALERT_RULES = 8

// 'HH:MM:SS' / 'H:M' → 'HH:MM'; érvénytelen → null
export function normalizeDeadline(t: string | null | undefined): string | null {
  const m = (t ?? '').trim().match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/)
  if (!m) return null
  const h = Number(m[1]); const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

// Határidő szerint, azon belül a kör sorrendjében
export function sortRules<T extends { deadline: string; scope: AlertScope }>(rules: T[]): T[] {
  const order = ALERT_SCOPES.map((s) => s.key)
  return [...rules].sort((a, b) => (normalizeDeadline(a.deadline) ?? '').localeCompare(normalizeDeadline(b.deadline) ?? '') || order.indexOf(a.scope) - order.indexOf(b.scope))
}

// Új szabály alapértéke: az első olyan (határidő, kör) pár, ami még nincs felvéve
export function nextNewRule(existing: { deadline: string; scope: AlertScope }[]): { deadline: string; scope: AlertScope } {
  const taken = new Set(existing.map((r) => `${normalizeDeadline(r.deadline)}|${r.scope}`))
  for (const deadline of ['05:00', '23:30', '06:00', '04:30', '22:00']) {
    for (const s of ALERT_SCOPES) if (!taken.has(`${deadline}|${s.key}`)) return { deadline, scope: s.key }
  }
  return { deadline: '12:00', scope: 'all' }
}

export function isDuplicateRule(rules: { id: string; deadline: string; scope: AlertScope }[], id: string | null, deadline: string, scope: AlertScope): boolean {
  return rules.some((r) => r.id !== id && normalizeDeadline(r.deadline) === normalizeDeadline(deadline) && r.scope === scope)
}

// ---- Futó riasztás (hangos szabály): a riasztó-képernyő adatai ----
export interface AlarmPerson { id: string; name: string; plate: string | null; route: string | null; round: number | null }
export interface SetOffAlarm { id: string; fired_at: string; deadline: string; missing: unknown; ended_reason: string | null }

// Mely riasztásokat kell mutatni: a le nem zártak közül azokat, amelyek nem oldódtak meg maguktól
// (közben mindenki elindult), és 3 óránál nem régebbiek
export function activeAlarms<T extends SetOffAlarm>(rows: T[], now = Date.now()): T[] {
  return rows.filter((a) => a.ended_reason !== 'resolved' && now - new Date(a.fired_at).getTime() < 3 * 3_600_000)
}

// A hiányzók egy listában (több szabály ugyanazt az embert is jelezheti — egyszer szerepeljen)
export function alarmPeople(alarms: SetOffAlarm[]): AlarmPerson[] {
  const seen = new Map<string, AlarmPerson>()
  for (const a of alarms) {
    if (!Array.isArray(a.missing)) continue
    for (const m of a.missing as Record<string, unknown>[]) {
      if (!m || typeof m.id !== 'string' || seen.has(m.id)) continue
      seen.set(m.id, {
        id: m.id, name: typeof m.name === 'string' && m.name ? m.name : 'Munkatárs',
        plate: typeof m.plate === 'string' ? m.plate : null, route: typeof m.route === 'string' ? m.route : null,
        round: typeof m.round === 'number' ? m.round : null,
      })
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'hu'))
}

// ---- Telefonhívás a riasztáshoz: mit írjunk ki az állapotáról ----
export interface CallStatus { configured: boolean; phone: string | null }
// null = minden rendben (be van kötve, van hívható szám); különben a teendő szövege
export function callProblem(st: CallStatus | null | undefined): string | null {
  if (!st) return null
  if (!st.configured) return 'A telefonhívás még nincs bekötve (a telefonos szolgáltató kulcsai hiányoznak) — addig csak az értesítés szól.'
  if (!st.phone) return 'A profilodban nincs hívható magyar mobilszám — a Tagok oldalon add meg (pl. +36 30 123 4567), különben a hívás nem indul el.'
  return null
}
