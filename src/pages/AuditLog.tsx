import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { resolveNames } from '../lib/names'
import {
  formatDateTime, formatDate, formatHuf,
  roleLabel, statusLabel, adjustmentTypeLabel, carIssueStatusLabel, evidenceCategoryLabel,
} from '../lib/labels'
import type { Enums } from '../lib/database.types'

const ENTITY_LABEL: Record<string, string> = {
  adjustments: 'Előleg/levonás', shifts: 'Beosztás', profiles: 'Felhasználó',
  evidence_photos: 'Bizonyíték', cars: 'Autó', fuel_logs: 'Tankolás',
  car_issues: 'Autó hiba', payroll_locks: 'Bérzárás', swap_requests: 'Csere',
}
const ACTION_LABEL: Record<string, string> = { INSERT: 'Létrehozás', UPDATE: 'Módosítás', DELETE: 'Törlés' }

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
      const who = [nm(s(d, 'driver_id')), nm(s(d, 'loader_id'))].filter(Boolean).join(' + ')
      const car = plate(s(d, 'car_id'))
      const where = [date, car, who].filter(Boolean).join(' · ')
      if (action === 'INSERT') return `Beosztás létrehozva — ${where}`
      if (action === 'DELETE') return `Beosztás törölve — ${where}`
      const ch: string[] = []
      if (o && n) {
        if (s(o, 'driver_id') !== s(n, 'driver_id')) ch.push(`sofőr: ${nm(s(o, 'driver_id')) ?? '—'} → ${nm(s(n, 'driver_id')) ?? '—'}`)
        if (s(o, 'loader_id') !== s(n, 'loader_id')) ch.push(`rakodó: ${nm(s(o, 'loader_id')) ?? '—'} → ${nm(s(n, 'loader_id')) ?? '—'}`)
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
const ID_KEYS = ['driver_id', 'loader_id', 'user_id', 'partner_id', 'requested_by', 'reported_by', 'actor_id']

export default function AuditLog() {
  const { data: cars } = useQuery({
    queryKey: ['audit-cars'],
    queryFn: async () => {
      const { data } = await supabase.from('cars').select('id, plate')
      return data ?? []
    },
  })

  const { data, isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: async () => {
      const { data } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100)
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

  return (
    <div className="stack">
      <h2>Napló</h2>
      <p className="small muted">A módosítások nyomon követése (bér, beosztás, cserék, felhasználók, autók, bizonyítékok).</p>
      {isLoading && <div className="card"><div className="spinner" /></div>}
      {!isLoading && (data?.length ?? 0) === 0 && <div className="empty"><span className="ico">📜</span>Nincs naplóbejegyzés.</div>}
      {data?.map((r) => {
        const names = r._names as Record<string, string>
        const nm = (id: string | null) => (id ? names[id] ?? null : null)
        const actorName = r.actor_id ? names[r.actor_id] ?? 'Munkatárs' : 'Rendszer'
        const text = describe(r.entity, r.action, r.detail as Detail, nm, plateOf)
        return (
          <div key={r.id} className="card" style={{ padding: 12 }}>
            <div className="between">
              <div className="row" style={{ gap: 6 }}>
                <span className="badge primary">{ENTITY_LABEL[r.entity] ?? r.entity}</span>
                <span className={`badge ${r.action === 'DELETE' ? 'danger' : r.action === 'INSERT' ? 'success' : ''}`}>{ACTION_LABEL[r.action] ?? r.action}</span>
              </div>
              <span className="tiny muted">{formatDateTime(r.created_at)}</span>
            </div>
            {text && <div className="small" style={{ marginTop: 6 }}>{text}</div>}
            <div className="tiny muted" style={{ marginTop: 4 }}>Végezte: {actorName}</div>
          </div>
        )
      })}
    </div>
  )
}
