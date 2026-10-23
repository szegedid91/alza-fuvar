import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { resolveNames } from '../lib/names'
import {
  formatDateTime, formatDate, formatHuf,
  roleLabel, statusLabel, adjustmentTypeLabel, carIssueStatusLabel, evidenceCategoryLabel,
} from '../lib/labels'
import type { Enums } from '../lib/database.types'
import Icon, { type IconName } from '../components/Icon'
import Skeleton from '../components/Skeleton'
import { localDateOf } from '../lib/calendar'

const ENTITY_LABEL: Record<string, string> = {
  adjustments: 'Előleg / levonás', shifts: 'Beosztás', profiles: 'Felhasználó',
  evidence_photos: 'Bizonyíték', cars: 'Autó', fuel_logs: 'Tankolás',
  car_issues: 'Autó hiba', payroll_locks: 'Bérzárás', swap_requests: 'Csere',
  check_ins: 'Becsekkolás', workspaces: 'Beállítás', car_categories: 'Kategória', box_sheets: 'Box-lap',
}
const ACTION_LABEL: Record<string, string> = { INSERT: 'Létrehozás', UPDATE: 'Módosítás', DELETE: 'Törlés' }
const ENTITY_ICON: Record<string, IconName> = {
  adjustments: 'wallet', shifts: 'calendar', profiles: 'user', evidence_photos: 'camera', cars: 'truck',
  fuel_logs: 'fuel', car_issues: 'wrench', payroll_locks: 'lock', swap_requests: 'repeat',
  check_ins: 'qr-code', workspaces: 'map-pin', car_categories: 'folder', box_sheets: 'package',
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
      const round = s(d, 'round') === '2' ? '2. kör' : ''
      const where = [date, car, round, who].filter(Boolean).join(' · ')
      if (action === 'INSERT') return `Beosztás létrehozva — ${where}`
      if (action === 'DELETE') return `Beosztás törölve — ${where}`
      const ch: string[] = []
      if (o && n) {
        if (s(o, 'driver_id') !== s(n, 'driver_id')) ch.push(`sofőr: ${nm(s(o, 'driver_id')) ?? '—'} → ${nm(s(n, 'driver_id')) ?? '—'}`)
        if (s(o, 'loader_id') !== s(n, 'loader_id')) ch.push(`rakodó: ${nm(s(o, 'loader_id')) ?? '—'} → ${nm(s(n, 'loader_id')) ?? '—'}`)
        if (s(o, 'trainee_id') !== s(n, 'trainee_id')) ch.push(`betanuló: ${nm(s(o, 'trainee_id')) ?? '—'} → ${nm(s(n, 'trainee_id')) ?? '—'}`)
        if (s(o, 'car_id') !== s(n, 'car_id')) ch.push(`autó: ${plate(s(o, 'car_id')) ?? '—'} → ${plate(s(n, 'car_id')) ?? '—'}`)
      }
      return `Beosztás módosítva — ${date}${car ? ` · ${car}` : ''}${ch.length ? ': ' + ch.join(', ') : ''}`
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
const ID_KEYS = ['driver_id', 'loader_id', 'trainee_id', 'user_id', 'partner_id', 'requested_by', 'reported_by', 'actor_id']

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
      const { data, error } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100)
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

  // Szűrő: típus szerint (a chipeken a darabszám), alapból minden
  const [entityFilter, setEntityFilter] = useState('')
  const counts = new Map<string, number>()
  for (const r of data ?? []) counts.set(r.entity, (counts.get(r.entity) ?? 0) + 1)
  const shown = (data ?? []).filter((r) => !entityFilter || r.entity === entityFilter)
  // Napok szerint csoportosítva: a dátum egyszer, a sorokon csak az idő
  const byDay = new Map<string, typeof shown>()
  for (const r of shown) {
    const d = localDateOf(r.created_at)
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d)!.push(r)
  }
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="stack">
      <h2>Napló</h2>
      <p className="small muted" style={{ margin: 0 }}>A módosítások nyomon követése (bér, beosztás, cserék, felhasználók, autók, kategóriák, beállítások, vezetői kijelentkeztetés) — az utolsó 100 bejegyzés.</p>
      <ClientErrors />
      {isLoading && <><Skeleton rows={3} /><Skeleton rows={3} /></>}
      {!isLoading && (data?.length ?? 0) === 0 && <div className="empty"><span className="ico"><Icon name="scroll" size={40} /></span>Nincs naplóbejegyzés.</div>}

      {(data?.length ?? 0) > 0 && (
        <div className="chips">
          <button type="button" className={`badge ${entityFilter === '' ? 'primary' : ''}`}
            style={{ cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, minHeight: 32 }}
            onClick={() => setEntityFilter('')}>Mind · {data!.length}</button>
          {[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([ent, n]) => (
            <button key={ent} type="button" className={`badge ${entityFilter === ent ? 'primary' : ''}`}
              style={{ cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, minHeight: 32 }}
              onClick={() => setEntityFilter(ent)}>
              <Icon name={ENTITY_ICON[ent] ?? 'file-text'} />{ENTITY_LABEL[ent] ?? ent} · {n}
            </button>
          ))}
        </div>
      )}

      {[...byDay.entries()].map(([day, rows]) => (
        <div key={day} className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="tiny muted" style={{ padding: '8px 12px', background: 'var(--bg-elev-2)', fontWeight: 700 }}>
            {formatDate(day)} · {new Date(`${day}T12:00:00`).toLocaleDateString('hu-HU', { weekday: 'long' })}
          </div>
          {rows.map((r) => {
            const names = (r._names ?? {}) as Record<string, string>
            const nm = (id: string | null) => (id ? names[id] ?? null : null)
            const actorName = r.actor_id ? names[r.actor_id] ?? 'Munkatárs' : 'Rendszer'
            const text = describe(r.entity, r.action, r.detail as Detail, nm, plateOf)
            const tone = r.action === 'DELETE' ? 'var(--danger)' : r.action === 'INSERT' ? 'var(--success)' : 'var(--text-dim)'
            return (
              <div key={r.id} className="row" style={{ gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
                <Icon name={ENTITY_ICON[r.entity] ?? 'file-text'} size={18} style={{ color: tone, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="small">{text ?? `${ENTITY_LABEL[r.entity] ?? r.entity} — ${ACTION_LABEL[r.action] ?? r.action}`}</div>
                  <div className="tiny muted">
                    <span style={{ color: tone, fontWeight: 700 }}>{ACTION_LABEL[r.action] ?? r.action}</span> · {actorName}
                  </div>
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
