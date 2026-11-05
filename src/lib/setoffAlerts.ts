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
