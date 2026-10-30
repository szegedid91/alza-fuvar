import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { resolveNames } from '../lib/names'
import {
  formatDateTime, formatDate, formatHuf,
  roleLabel, statusLabel, adjustmentTypeLabel, carIssueStatusLabel, evidenceCategoryLabel, swapStatusLabel,
} from '../lib/labels'
import type { Enums } from '../lib/database.types'
import Icon, { type IconName } from '../components/Icon'
import Skeleton from '../components/Skeleton'
import FeedbackList from '../components/FeedbackList'
import { useAlzaBoxes } from '../hooks/useAlzaBoxes'
import { localDateOf } from '../lib/calendar'

const ENTITY_LABEL: Record<string, string> = {
  adjustments: 'Előleg / levonás', shifts: 'Beosztás', profiles: 'Felhasználó',
  evidence_photos: 'Bizonyíték', cars: 'Autó', fuel_logs: 'Tankolás',
  car_issues: 'Autó hiba', payroll_locks: 'Bérzárás', swap_requests: 'Csere',
  check_ins: 'Becsekkolás', workspaces: 'Beállítás', car_categories: 'Kategória', box_sheets: 'Box-lap',
  route_names: 'Járat', status_templates: 'Hiba-sablon', invites: 'Meghívó', route_stops: 'Járat-megálló',
}
const ACTION_LABEL: Record<string, string> = { INSERT: 'Létrehozás', UPDATE: 'Módosítás', DELETE: 'Törlés' }
const ENTITY_ICON: Record<string, IconName> = {
  adjustments: 'wallet', shifts: 'calendar', profiles: 'user', evidence_photos: 'camera', cars: 'truck',
  fuel_logs: 'fuel', car_issues: 'wrench', payroll_locks: 'lock', swap_requests: 'repeat',
  check_ins: 'qr-code', workspaces: 'map-pin', car_categories: 'folder', box_sheets: 'package',
  route_names: 'map', status_templates: 'file-text', invites: 'send', route_stops: 'map-pin',
}

// Mezőnkénti változás-lista: minden bejegyzésnél látszik, melyik mező miről mire változott
const FIELD_LABEL: Record<string, string> = {
  fuel_type: 'Hajtás', depot_name: 'Raktár neve', depot_address: 'Raktár címe', depot_lat: 'Raktár szélesség', depot_lng: 'Raktár hosszúság',
  box_id: 'Box', moved_from_route_id: 'Eredeti járat', moved_from_order: 'Eredeti hely',
  driver_id: 'Sofőr', loader_id: 'Rakodó', trainee_id: 'Betanuló', route_id: 'Járat', round: 'Kör sorszáma', car_id: 'Autó', work_date: 'Dátum',
  user_id: 'Munkatárs', amount: 'Összeg', reason: 'Indok', type: 'Típus', status: 'Állapot', role: 'Szerep', full_name: 'Név', email: 'Email',
  phone: 'Telefon', plate: 'Rendszám', label: 'Megnevezés', category_id: 'Kategória', active: 'Aktív', crew_size: 'Létszám (fő)', box_sheet: 'Box-lap',
  sort_order: 'Sorrend', name: 'Név', code: 'Kód', text: 'Szöveg', driver_day_rate: 'XL sofőr napidíj', loader_day_rate: 'XL rakodó napidíj',
  box_day_rate: 'Box 1. kör díj', box_round2_day_rate: 'Box 2. kör díj', trainee_day_rate: 'XL betanuló díj', box_trainee_day_rate: 'Box betanuló díj',
  geo_lat: 'Telephely (szélesség)', geo_lng: 'Telephely (hosszúság)', geo_radius_m: 'Telephely sugár (m)', photo_retention_days: 'Kép-megőrzés (nap)',
  arrival_whatsapp_group: 'WhatsApp-csoport link', arrival_whatsapp_group_name: 'WhatsApp-csoport neve', checked_in_at: 'Becsekkolás ideje',
  checked_out_at: 'Kijelentkezés ideje', inspection_waived_at: 'Fotó nélkül továbbengedve', inspection_waived_by: 'Továbbengedte',
  inspection_waive_note: 'Továbbengedés megjegyzés', switch_reason: 'Autócsere oka', prev_car_id: 'Előző autó', manual_checkin: 'Kézi becsekkolás',
  crew_conflict: 'Létszám-ütközés', outside_geofence: 'Telephelyen kívül (be)', out_outside_geofence: 'Telephelyen kívül (ki)', odometer_km: 'Km-óra',
  liters: 'Liter', fuel_date: 'Tankolás dátuma', location: 'Hely', note: 'Megjegyzés', resolved_by: 'Megoldotta', resolved_at: 'Megoldva',
  category: 'Kategória', ym: 'Hónap', locked_by: 'Zárolta', pay_type: 'Bértípus', pay_amount: 'Bér', workspace_id: 'Munkaterület',
  approved_by: 'Jóváhagyta', approved_at: 'Jóváhagyva', start_time: 'Indulás', end_time: 'Végzés', expires_at: 'Lejárat', used_at: 'Felhasználva',
  used_by: 'Felhasználta', placeholder_id: 'Helyőrző fiók', partner_decision: 'Társ döntése', decided_by: 'Döntött', decided_at: 'Döntés ideje',
  partner_id: 'Társ', requested_by: 'Kérte', shift_id: 'Beosztás', evidence_id: 'Bizonyíték', submitted_at: 'Lezárva',
}
// Technikai mezők, amik nem érdekesek a naplóban
const NOISE = new Set(['id', 'created_at', 'updated_at', 'created_by', 'gps_lat', 'gps_lng', 'out_gps_lat', 'out_gps_lng', 'crew_key',
  'inspection_alert_sent_at', 'inspection_crew_reminders', 'inspection_crew_reminded_at', 'inspection_help_requested_at', 'qr_token',
  'photo_path', 'storage_path', 'ocr_location', 'ocr_date', 'ocr_amount', 'ocr_liters', 'taken_at', 'verified', 'consumption', 'km_warning', 'workspace_id'])
const ENUM_LABELS: Record<string, Record<string, string>> = {
  'profiles.status': statusLabel as Record<string, string>, 'profiles.role': roleLabel as Record<string, string>, 'invites.role': roleLabel as Record<string, string>,
  'car_issues.status': carIssueStatusLabel as Record<string, string>, 'adjustments.type': adjustmentTypeLabel as Record<string, string>,
  'evidence_photos.category': evidenceCategoryLabel as Record<string, string>, 'swap_requests.status': swapStatusLabel as Record<string, string>,
  'swap_requests.partner_decision': swapStatusLabel as Record<string, string>, 'box_sheets.status': { draft: 'Piszkozat', submitted: 'Lezárva' },
  'cars.fuel_type': { diesel: 'Dízel / benzin', electric: 'Elektromos' },
}
interface Lookups { nm: (id: string | null) => string | null; plate: (id: string | null) => string | null; route: (id: string | null) => string | null; cat: (id: string | null) => string | null; box?: (id: string | null) => string | null }
function fmtValue(entity: string, key: string, v: unknown, lk: Lookups): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'igen' : 'nem'
  const sv = String(v)
  const enumMap = ENUM_LABELS[`${entity}.${key}`]
  if (enumMap) return enumMap[sv] ?? sv
  if (key === 'car_id' || key === 'prev_car_id') return lk.plate(sv) ?? sv.slice(0, 8)
  if (key === 'route_id') return lk.route(sv) ?? sv.slice(0, 8)
  if (key === 'box_id') return lk.box?.(sv) ?? sv.slice(0, 8)
  if (key === 'moved_from_route_id') return lk.route(sv) ?? sv.slice(0, 8)
  if (key === 'category_id') return lk.cat(sv) ?? sv.slice(0, 8)
  if (key.endsWith('_id') || key.endsWith('_by')) return lk.nm(sv) ?? sv.slice(0, 8)
  if (/_rate$|^amount$|^pay_amount$/.test(key)) return formatHuf(Number(v))
  if (key.endsWith('_at')) return formatDateTime(sv)
  if (key === 'work_date' || key === 'fuel_date') return formatDate(sv)
  if (key === 'start_time' || key === 'end_time') return sv.slice(0, 5)
  return sv
}
// Mezőnkénti különbség: UPDATE-nél a változott mezők (miről mire), INSERT/DELETE-nél a fontosabb mezők értékei
function fieldDiff(entity: string, action: string, detail: Detail, lk: Lookups): { label: string; from: string | null; to: string }[] {
  const o = detail?.old ?? null, n = detail?.new ?? null
  const label = (k: string) => FIELD_LABEL[k] ?? k.replace(/_/g, ' ')
  if (action === 'UPDATE' && o && n) {
    const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter((k) => !NOISE.has(k))
    return keys.filter((k) => String(o[k] ?? '') !== String(n[k] ?? '')).map((k) => ({ label: label(k), from: fmtValue(entity, k, o[k], lk), to: fmtValue(entity, k, n[k], lk) }))
  }
  const d = action === 'DELETE' ? o : n
  if (!d) return []
  return Object.keys(d).filter((k) => !NOISE.has(k) && d[k] != null && d[k] !== '' && d[k] !== false && d[k] !== 0)
    .map((k) => ({ label: label(k), from: null, to: fmtValue(entity, k, d[k], lk) }))
}

type Row = Record<string, unknown> | null | undefined
type Detail = { old?: Row; new?: Row } | null

const s = (r: Row, k: string): string | null => {
  const v = r?.[k]
  return v == null ? null : String(v)
}

// Emberi, magyar leírás a naplóbejegyzéshez a régi/új sor alapján
function describe(
  entity: string,
  action: string,
  detail: Detail,
  nm: (id: string | null) => string | null,
  plate: (id: string | null) => string | null,
  lk: { route: (id: string | null) => string | null; box: (id: string | null) => string | null } = { route: () => null, box: () => null },
): string | null {
  const o = detail?.old
  const n = detail?.new
  const d = n ?? o

  switch (entity) {
    case 'swap_requests': {
      const partner = nm(s(d, 'partner_id'))
      const requester = nm(s(d, 'requested_by'))
      if (action === 'INSERT') {
        return `${requester ?? 'Munkatárs'} sofőr ↔ rakodó cserét kért${partner ? ` — társ: ${partner}` : ''}`
      }
      if (action === 'UPDATE' && o && n) {
        if (s(o, 'partner_decision') === 'pending' && s(n, 'partner_decision') === 'approved') {
          return `${partner ?? 'A társ'} elfogadta a cserekérést${requester ? ` (kérte: ${requester})` : ''}`
        }
        if (s(o, 'partner_decision') === 'pending' && s(n, 'partner_decision') === 'rejected') {
          return `${partner ?? 'A társ'} elutasította a cserekérést${requester ? ` (kérte: ${requester})` : ''}`
        }
        if (s(o, 'status') === 'pending' && s(n, 'status') === 'approved') {
          return `A vezető jóváhagyta a cserét${requester && partner ? ` (${requester} ↔ ${partner})` : ''} — a beosztás frissült`
        }
        if (s(o, 'status') === 'pending' && s(n, 'status') === 'rejected') {
          return `A vezető elutasította a cserét${requester && partner ? ` (${requester} ↔ ${partner})` : ''}`
        }
        return 'Cserekérés módosítva'
      }
      return 'Cserekérés törölve'
    }

    case 'shifts': {
      const date = s(d, 'work_date') ? formatDate(s(d, 'work_date')) : ''
      const trainee = nm(s(d, 'trainee_id'))
      const who = [nm(s(d, 'driver_id')), nm(s(d, 'loader_id'))].filter(Boolean).join(' + ') + (trainee ? ` + betanuló: ${trainee}` : '')
      const car = plate(s(d, 'car_id'))
      const round = s(d, 'round') === '2' ? '2. kör' : s(d, 'route_id') ? '1. kör' : ''
      const where = [date, car, round, who].filter(Boolean).join(' · ')
      if (action === 'INSERT') return `Beosztás létrehozva — ${where}`
      if (action === 'DELETE') return `Beosztás törölve — ${where}`
      return `Beosztás módosítva — ${[date, car, round].filter(Boolean).join(' · ')}`
    }

    case 'profiles': {
      const who = nm(s(d, 'id')) ?? s(d, 'full_name') ?? s(d, 'email') ?? 'Felhasználó'
      if (action === 'DELETE') return `Felhasználó törölve: ${who}`
      if (action === 'UPDATE' && o && n) {
        const ch: string[] = []
        if (s(o, 'status') !== s(n, 'status')) {
          const st = s(n, 'status') as Enums<'user_status'> | null
          ch.push(`állapot: ${st ? statusLabel[st] ?? st : '—'}`)
        }
        if (s(o, 'role') !== s(n, 'role')) {
          const ro = s(n, 'role') as Enums<'user_role'> | null
          ch.push(`szerep: ${ro ? roleLabel[ro] ?? ro : '—'}`)
        }
        if (s(o, 'pay_amount') !== s(n, 'pay_amount') || s(o, 'pay_type') !== s(n, 'pay_type')) ch.push('bérezés módosítva')
        if (s(o, 'full_name') !== s(n, 'full_name')) ch.push(`név: ${s(n, 'full_name') ?? '—'}`)
        if (s(o, 'phone') !== s(n, 'phone')) ch.push('telefonszám módosítva')
        return `${who} — ${ch.join(', ') || 'adatok módosítva'}`
      }
      return `Új felhasználó: ${who}`
    }

    case 'cars': {
      const p = s(d, 'plate') ?? '?'
      if (action === 'INSERT') return `Új autó: ${p}`
      if (action === 'DELETE') return `Autó törölve: ${p}`
      const ch: string[] = []
      if (o && n) {
        if (s(o, 'active') !== s(n, 'active')) ch.push(s(n, 'active') === 'true' ? 'aktiválva' : 'inaktiválva')
        if (s(o, 'plate') !== s(n, 'plate')) ch.push(`rendszám: ${s(o, 'plate')} → ${s(n, 'plate')}`)
        if (s(o, 'category_id') !== s(n, 'category_id')) ch.push('kategória módosítva')
        if (s(o, 'label') !== s(n, 'label')) ch.push('megnevezés módosítva')
      }
      return `Autó ${p}${ch.length ? ' — ' + ch.join(', ') : ' módosítva'}`
    }

    case 'adjustments': {
      const t = s(d, 'type') as Enums<'adjustment_type'> | null
      const label = t ? adjustmentTypeLabel[t] ?? t : 'Tétel'
      const amount = d?.['amount'] != null ? formatHuf(Number(d['amount'])) : ''
      const who = nm(s(d, 'user_id'))
      const base = `${label} ${amount}${who ? ` — ${who}` : ''}`
      if (action === 'DELETE') return `Törölve: ${base}`
      if (action === 'UPDATE') return `Módosítva: ${base}`
      return base
    }

    case 'fuel_logs': {
      const amount = d?.['amount'] != null ? formatHuf(Number(d['amount'])) : ''
      const who = nm(s(d, 'user_id'))
      const p = plate(s(d, 'car_id'))
      if (action === 'DELETE') return `Tankolás törölve${p ? ` — ${p}` : ''} ${amount}`
      return `Tankolás módosítva${p ? ` — ${p}` : ''} ${amount}${who ? ` (${who})` : ''}`
    }

    case 'car_issues': {
      const p = plate(s(d, 'car_id'))
      const who = nm(s(d, 'user_id'))
      if (action === 'INSERT') return `Hibabejelentés${p ? ` — ${p}` : ''}${who ? ` (${who})` : ''}`
      if (action === 'UPDATE' && o && n && s(o, 'status') !== s(n, 'status')) {
        const st = s(n, 'status') as Enums<'car_issue_status'> | null
        return `Hiba állapota${p ? ` (${p})` : ''}: ${st ? carIssueStatusLabel[st] ?? st : '—'}`
      }
      if (action === 'DELETE') return `Hibabejelentés törölve${p ? ` — ${p}` : ''}`
      return null
    }

    case 'evidence_photos': {
      const cat = s(d, 'category') as Enums<'evidence_category'> | null
      const who = nm(s(d, 'user_id'))
      const label = cat ? evidenceCategoryLabel[cat] ?? cat : 'Bizonyíték'
      if (action === 'DELETE') return `${label} törölve${who ? ` (${who})` : ''}`
      return `${label}${who ? ` — ${who}` : ''}`
    }

    // Csak vezetői beavatkozás kerül ide (a munkatárs saját be-/kijelentkezése nem)
    case 'check_ins': {
      const who = nm(s(d, 'user_id'))
      const p = plate(s(d, 'car_id'))
      const where = [who, p].filter(Boolean).join(' · ')
      if (action === 'DELETE') return `Becsekkolás törölve (vezető) — ${where}`
      if (o && n && !s(o, 'checked_out_at') && s(n, 'checked_out_at')) return `Kijelentkeztetve a vezető által — ${where}`
      if (o && n && s(o, 'checked_out_at') && !s(n, 'checked_out_at')) return `Becsekkolás újranyitva (vezető) — ${where}`
      if (o && n && s(o, 'car_id') !== s(n, 'car_id')) return `Becsekkolás autója módosítva — ${who ?? ''}: ${plate(s(o, 'car_id')) ?? '—'} → ${p ?? '—'}`
      return `Becsekkolás módosítva (vezető) — ${where}`
    }

    case 'workspaces': {
      const ch: string[] = []
      if (o && n) {
        if (s(o, 'name') !== s(n, 'name')) ch.push(`név: ${s(n, 'name')}`)
        if (s(o, 'driver_day_rate') !== s(n, 'driver_day_rate')) ch.push(`sofőr napidíj: ${formatHuf(Number(o?.['driver_day_rate'] ?? 0))} → ${formatHuf(Number(n?.['driver_day_rate'] ?? 0))}`)
        if (s(o, 'loader_day_rate') !== s(n, 'loader_day_rate')) ch.push(`rakodó napidíj: ${formatHuf(Number(o?.['loader_day_rate'] ?? 0))} → ${formatHuf(Number(n?.['loader_day_rate'] ?? 0))}`)
        if (s(o, 'geo_lat') !== s(n, 'geo_lat') || s(o, 'geo_lng') !== s(n, 'geo_lng') || s(o, 'geo_radius_m') !== s(n, 'geo_radius_m')) {
          ch.push(s(n, 'geo_lat') ? `telephely: ${s(n, 'geo_radius_m') ?? '?'} m sugár` : 'telephely törölve')
        }
        if (s(o, 'photo_retention_days') !== s(n, 'photo_retention_days')) ch.push(`kép-megőrzés: ${s(o, 'photo_retention_days') ?? '?'} → ${s(n, 'photo_retention_days') ?? '?'} nap`)
      }
      return `Munkaterület-beállítás — ${ch.join(', ') || 'módosítva'}`
    }

    case 'car_categories': {
      const name = s(d, 'name') ?? 'kategória'
      if (action === 'INSERT') return `Új kategória: ${name}`
      if (action === 'DELETE') return `Kategória törölve: ${name}`
      const ch: string[] = []
      if (o && n) {
        if (s(o, 'name') !== s(n, 'name')) ch.push(`név: ${s(o, 'name')} → ${s(n, 'name')}`)
        if (s(o, 'crew_size') !== s(n, 'crew_size')) ch.push(`létszám: ${s(n, 'crew_size')} fő`)
        if (s(o, 'sort_order') !== s(n, 'sort_order')) ch.push('sorrend módosítva')
      }
      return `Kategória ${name}${ch.length ? ' — ' + ch.join(', ') : ' módosítva'}`
    }

    case 'route_names': {
      const code = s(d, 'code') ?? '?'
      return action === 'INSERT' ? `Új járat: ${code}` : action === 'DELETE' ? `Járat törölve: ${code}` : `Járat módosítva: ${code}`
    }
    case 'route_stops': {
      const r = lk.route(s(d, 'route_id'))
      const b = lk.box(s(d, 'box_id'))
      const pos = s(d, 'sort_order')
      const where = `${r ?? '?'} járat${b ? ` · ${b}` : ''}${pos ? ` · ${pos}. hely` : ''}`
      return action === 'INSERT' ? `Box felkerült a járatra: ${where}` : action === 'DELETE' ? `Box lekerült a járatról: ${where}` : `Járat-megálló módosítva: ${where}`
    }
    case 'status_templates': {
      const t = s(d, 'text') ?? ''
      return action === 'INSERT' ? `Új hiba-sablon: ${t}` : action === 'DELETE' ? `Hiba-sablon törölve: ${t}` : `Hiba-sablon módosítva: ${t}`
    }
    case 'invites': {
      const who = s(d, 'full_name') ?? s(d, 'email') ?? 'munkatárs'
      return action === 'INSERT' ? `Meghívó / előre felvett munkatárs: ${who}` : `Meghívó törölve: ${who}`
    }

    case 'payroll_locks': {
      const month = s(d, 'ym') ?? ''
      if (action === 'DELETE') return `Hónap feloldva${month ? `: ${month}` : ''}`
      return `Hónap lezárva${month ? `: ${month}` : ''}`
    }

    default:
      return null
  }
}

// A leírásokhoz szükséges személy-azonosítók összegyűjtése a régi/új sorokból
const ID_KEYS = ['driver_id', 'loader_id', 'trainee_id', 'user_id', 'partner_id', 'requested_by', 'reported_by', 'actor_id', 'inspection_waived_by', 'resolved_by', 'locked_by', 'decided_by', 'placeholder_id', 'used_by', 'approved_by']

export default function AuditLog() {
  const { data: cars } = useQuery({
    queryKey: ['audit-cars'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cars').select('id, plate')
      if (error) throw error
      return data ?? []
    },
  })

  const { data, isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: async () => {
      const { data, error } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(300)
      if (error) throw error
      const rows = data ?? []
      const ids = new Set<string>()
      for (const r of rows) {
        if (r.actor_id) ids.add(r.actor_id)
        const det = r.detail as Detail
        for (const part of [det?.old, det?.new]) {
          if (!part) continue
          for (const k of ID_KEYS) {
            const v = part[k]
            if (typeof v === 'string' && v) ids.add(v)
          }
          if (r.entity === 'profiles' && typeof part['id'] === 'string') ids.add(part['id'] as string)
        }
      }
      const names = await resolveNames([...ids])
      return rows.map((r) => ({ ...r, _names: names }))
    },
  })

  const plateOf = (id: string | null) => (id ? cars?.find((c) => c.id === id)?.plate ?? null : null)
  const { data: routes } = useQuery({ queryKey: ['audit-routes'], queryFn: async () => { const { data, error } = await supabase.from('route_names').select('id, code'); if (error) throw error; return data ?? [] } })
  const { data: cats } = useQuery({ queryKey: ['audit-cats'], queryFn: async () => { const { data, error } = await supabase.from('car_categories').select('id, name'); if (error) throw error; return data ?? [] } })
  const routeOf = (id: string | null) => (id ? routes?.find((r) => r.id === id)?.code ?? null : null)
  const { data: boxes } = useAlzaBoxes()
  const boxOf = (id: string | null) => { if (!id) return null; const b = boxes?.find((x) => x.id === id); return b ? `${b.code ? b.code + ' · ' : ''}${b.name}` : null }
  const catOf = (id: string | null) => (id ? cats?.find((c) => c.id === id)?.name ?? null : null)
  // Hosszú változás-listák kinyitása bejegyzésenként
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  // Szűrő: típus szerint (a chipeken a darabszám), alapból minden
  const [entityFilter, setEntityFilter] = useState('')
  // Keresés: név, rendszám, kör-kód, mezőérték — a megjelenített szövegben (feloldott nevekkel) keres,
  // ékezet-függetlenül; több szó esetén mindnek illeszkednie kell (szókezdetre; egybetűs keresés — pl. „G” — csak a pontos G járatot adja)
  const [search, setSearch] = useState('')
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const terms = norm(search).split(/[^a-z0-9]+/).filter(Boolean)
  const entries = (data ?? []).map((r) => {
    const names = (r._names ?? {}) as Record<string, string>
    const nm = (id: string | null) => (id ? names[id] ?? null : null)
    const actorName = r.actor_id ? names[r.actor_id] ?? 'Munkatárs' : 'Rendszer'
    const text = describe(r.entity, r.action, r.detail as Detail, nm, plateOf, { route: routeOf, box: boxOf })
      ?? `${ENTITY_LABEL[r.entity] ?? r.entity} — ${ACTION_LABEL[r.action] ?? r.action}`
    const diff = fieldDiff(r.entity, r.action, r.detail as Detail, { nm, plate: plateOf, route: routeOf, cat: catOf, box: boxOf })
    // A rekord teljes tartalma is kereshető (pl. a sofőr neve akkor is, ha csak a kör változott)
    const det = r.detail as Detail
    const rec = det?.new ?? det?.old ?? {}
    const lk = { nm, plate: plateOf, route: routeOf, cat: catOf }
    const ctx = Object.keys(rec).filter((k) => !NOISE.has(k)).map((k) => fmtValue(r.entity, k, rec[k], lk))
    const hay = norm([text, actorName, ENTITY_LABEL[r.entity] ?? r.entity, ...ctx, ...diff.flatMap((f) => [f.label, f.from ?? '', f.to])].join(' '))
    const tokens = hay.split(/[^a-z0-9]+/).filter(Boolean)
    return { r, actorName, text, diff, tokens }
  })
  const matched = entries.filter(({ tokens }) => terms.every((t) => tokens.some((tok) => (t.length === 1 ? tok === t : tok.startsWith(t)))))
  const counts = new Map<string, number>()
  for (const { r } of matched) counts.set(r.entity, (counts.get(r.entity) ?? 0) + 1)
  const shown = matched.filter(({ r }) => !entityFilter || r.entity === entityFilter)
  // Napok szerint csoportosítva: a dátum egyszer, a sorokon csak az idő
  const byDay = new Map<string, typeof shown>()
  for (const e of shown) {
    const d = localDateOf(e.r.created_at)
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d)!.push(e)
  }
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="stack">
      <h2>Napló</h2>
      <p className="small muted" style={{ margin: 0 }}>Ki, mikor, mit módosított — mezőnként, miről mire (bér, beosztás, járatok, cserék, felhasználók, meghívók, autók, kategóriák, sablonok, beállítások, vezetői beavatkozások). Az utolsó 300 bejegyzés.</p>
      <FeedbackList />
      <ClientErrors />
      {isLoading && <><Skeleton rows={3} /><Skeleton rows={3} /></>}
      {!isLoading && (data?.length ?? 0) === 0 && <div className="empty"><span className="ico"><Icon name="scroll" size={40} /></span>Nincs naplóbejegyzés.</div>}

      {(data?.length ?? 0) > 0 && (
        <div className="input-icon">
          <Icon name="search" size={18} />
          <input className="input" placeholder="Keresés: név, rendszám, járat (pl. G), érték…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}
      {(data?.length ?? 0) > 0 && (
        <div className="chips">
          <button type="button" className={`badge ${entityFilter === '' ? 'primary' : ''}`}
            style={{ cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, minHeight: 32 }}
            onClick={() => setEntityFilter('')}>Mind · {matched.length}</button>
          {[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([ent, n]) => (
            <button key={ent} type="button" className={`badge ${entityFilter === ent ? 'primary' : ''}`}
              style={{ cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, minHeight: 32 }}
              onClick={() => setEntityFilter(ent)}>
              <Icon name={ENTITY_ICON[ent] ?? 'file-text'} />{ENTITY_LABEL[ent] ?? ent} · {n}
            </button>
          ))}
        </div>
      )}

      {!isLoading && (data?.length ?? 0) > 0 && shown.length === 0 && (
        <div className="empty"><span className="ico"><Icon name="search" size={40} /></span>Nincs találat a szűrésre.</div>
      )}
      {[...byDay.entries()].map(([day, rows]) => (
        <div key={day} className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="tiny muted" style={{ padding: '8px 12px', background: 'var(--bg-elev-2)', fontWeight: 700 }}>
            {formatDate(day)} · {new Date(`${day}T12:00:00`).toLocaleDateString('hu-HU', { weekday: 'long' })}
          </div>
          {rows.map(({ r, actorName, text, diff }) => {
            const tone = r.action === 'DELETE' ? 'var(--danger)' : r.action === 'INSERT' ? 'var(--success)' : 'var(--text-dim)'
            const open = openIds.has(r.id)
            const shownDiff = open ? diff : diff.slice(0, 4)
            return (
              <div key={r.id} className="row" style={{ gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
                <Icon name={ENTITY_ICON[r.entity] ?? 'file-text'} size={18} style={{ color: tone, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="small">{text}</div>
                  <div className="tiny muted">
                    <span style={{ color: tone, fontWeight: 700 }}>{ACTION_LABEL[r.action] ?? r.action}</span> · {actorName}
                  </div>
                  {shownDiff.length > 0 && (
                    <div className="tiny" style={{ marginTop: 4, display: 'grid', gap: 2 }}>
                      {shownDiff.map((f, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <span className="muted">{f.label}:</span>
                          {f.from != null ? (
                            <span><s style={{ color: 'var(--text-dim)' }}>{f.from}</s> → <strong>{f.to}</strong></span>
                          ) : <span>{f.to}</span>}
                        </div>
                      ))}
                      {diff.length > 4 && (
                        <button type="button" className="link-btn tiny" style={{ justifySelf: 'start', padding: 0 }}
                          onClick={() => setOpenIds((p) => { const n = new Set(p); if (open) n.delete(r.id); else n.add(r.id); return n })}>
                          {open ? 'kevesebb' : `+${diff.length - 4} további mező`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <span className="tiny muted" style={{ flexShrink: 0 }}>{hhmm(r.created_at)}</span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// Telefonokról érkező app-hibák (összeomlás, kezeletlen hiba) — 30 napig
// tárolódnak. Ha ugyanaz a hiba sok eszközön jön, az programhiba, nem véletlen.
function ClientErrors() {
  const { data } = useQuery({
    queryKey: ['client-errors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_errors')
        .select('id, user_id, path, message, build, user_agent, created_at')
        .order('created_at', { ascending: false }).limit(30)
      if (error) throw error
      const rows = data ?? []
      const names = await resolveNames(rows.map((r) => r.user_id))
      return rows.map((r) => ({ ...r, _name: r.user_id ? names[r.user_id] ?? null : null }))
    },
  })
  const [open, setOpen] = useState(false)
  if (!data || data.length === 0) return null
  return (
    <div className="card stack" style={{ borderColor: 'var(--warning)' }}>
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}><Icon name="alert-triangle" style={{ color: 'var(--warning)' }} />App-hibák az eszközökről ({data.length})</div>
        <button className="btn ghost sm auto" onClick={() => setOpen((v) => !v)}>{open ? 'Elrejt' : 'Mutat'}</button>
      </div>
      {open && data.map((r) => (
        <div key={r.id} className="stack" style={{ gap: 2, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div className="between">
            <span className="small" style={{ fontWeight: 700 }}>{r._name ?? 'Ismeretlen'} · {r.path ?? '—'}</span>
            <span className="tiny muted">{formatDateTime(r.created_at)}</span>
          </div>
          <div className="tiny" style={{ color: 'var(--error-text)', wordBreak: 'break-word' }}>{r.message}</div>
          <div className="tiny muted">
            {r.build ? `build: ${new Date(r.build).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' })}` : ''}
            {r.user_agent ? ` · ${r.user_agent.slice(0, 80)}` : ''}
          </div>
        </div>
      ))}
    </div>
  )
}
