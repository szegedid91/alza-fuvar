import type { Enums } from './database.types'

// Magyar címkék az enum értékekhez (a DB angolul tárol, az UI magyar)
export const roleLabel: Record<Enums<'user_role'>, string> = {
  crew: 'Munkatárs',
  driver: 'Sofőr',
  loader: 'Rakodó',
  manager: 'Menedzser',
  admin: 'Adminisztrátor',
}

// Napi (beosztás szerinti) szerep címkéje — a shiftből származik, nem a profilból.
export const dailyRoleLabel = { driver: 'Sofőr', loader: 'Rakodó' } as const

// Egységes "munkatárs" (sofőr/rakodó) szerep felismerése.
// A driver/loader régi értékek visszafelé kompatibilisek maradnak.
export function isCrewRole(role: Enums<'user_role'> | null | undefined): boolean {
  return role === 'crew' || role === 'driver' || role === 'loader'
}

export const statusLabel: Record<Enums<'user_status'>, string> = {
  pending: 'Jóváhagyásra vár',
  active: 'Aktív',
  disabled: 'Letiltva',
}

export const adjustmentTypeLabel: Record<Enums<'adjustment_type'>, string> = {
  advance: 'Előleg',
  deduction: 'Levonás',
}

export const inspectionViewLabel: Record<Enums<'inspection_view'>, string> = {
  front: 'Elöl',
  rear: 'Hátul',
  left: 'Bal oldal',
  right: 'Jobb oldal',
  interior: 'Beltér',
}

export const carIssueStatusLabel: Record<Enums<'car_issue_status'>, string> = {
  open: 'Nyitott',
  in_progress: 'Folyamatban',
  resolved: 'Megoldva',
}

export const swapStatusLabel: Record<Enums<'swap_status'>, string> = {
  pending: 'Függőben',
  approved: 'Jóváhagyva',
  rejected: 'Elutasítva',
}

// Ledolgozott órák formázása (pl. 8,5 ó)
export function formatHours(ms: number): string {
  const h = ms / 3600000
  return `${(Math.round(h * 10) / 10).toLocaleString('hu-HU')} ó`
}

export const evidenceCategoryLabel: Record<Enums<'evidence_category'>, string> = {
  dirt: 'Kosz',
  damage: 'Törés',
  cigarette_burn: 'Cigarettaégés',
  other: 'Egyéb',
}

export function formatHuf(n: number | null | undefined): string {
  if (n == null) return '–'
  return new Intl.NumberFormat('hu-HU', { style: 'currency', currency: 'HUF', maximumFractionDigits: 0 }).format(n)
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '–'
  const date = typeof d === 'string' ? new Date(d) : d
  return new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return '–'
  const date = typeof d === 'string' ? new Date(d) : d
  return new Intl.DateTimeFormat('hu-HU', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

// Magyar számbevitel parsolása. Kezeli a szóköz/nem-törő-szóköz ezres-elválasztót,
// a vessző tizedesjelet és a pontozott ezres-csoportokat.
// "1 234,5" -> 1234.5 · "1.234,56" -> 1234.56 · "1.234" -> 1234 · "12.5" -> 12.5
// Érvénytelen bemenetre NaN — a hívó ellenőrizze Number.isFinite-tel.
export function parseHuNumber(input: string): number {
  const t = input.replace(/[\s ]/g, '').replace(/[^0-9.,-]/g, '')
  if (!t) return NaN
  const lastComma = t.lastIndexOf(',')
  const lastDot = t.lastIndexOf('.')
  let s = t
  if (lastComma > -1 && lastDot > -1) {
    // mindkettő jelen: a hátrébb álló a tizedesjel, a többi ezres-elválasztó
    const dec = Math.max(lastComma, lastDot)
    s = t.slice(0, dec).replace(/[.,]/g, '') + '.' + t.slice(dec + 1).replace(/[.,]/g, '')
  } else if (lastComma > -1) {
    // csak vessző: az utolsó a tizedesjel
    s = t.slice(0, lastComma).replace(/,/g, '') + '.' + t.slice(lastComma + 1)
  } else if (lastDot > -1) {
    // csak pont: ha ezres-csoportokat formáz (minden pont után pontosan 3 számjegy), elválasztó
    const groups = t.split('.')
    const thousands = groups.length > 1 && groups.slice(1).every((g) => /^\d{3}$/.test(g)) && /^-?\d{1,3}$/.test(groups[0])
    s = thousands ? groups.join('') : t
  }
  return parseFloat(s)
}

export function todayISO(): string {
  const now = new Date()
  const tz = now.getTimezoneOffset() * 60000
  return new Date(now.getTime() - tz).toISOString().slice(0, 10)
}
