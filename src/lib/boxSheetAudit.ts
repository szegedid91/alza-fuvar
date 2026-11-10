// A Box-lap utólagos módosításai a naplóból: ki, mikor, mit miről mire.
// Az adatbázis-trigger minden lap- és megálló-módosítást naplóz, és jelzi, ha utólagos
// (megálló: 15 perccel a leadás után; lap: lezárás után vagy másnap).
import { STOP_FIELDS, COMP_FIELDS, WH_FIELDS, RET_FIELDS } from './boxSheet'

export interface AuditRow { id: string; entity: string; action: string; actor_id: string | null; created_at: string; entity_id: string | null; detail: Record<string, unknown> | null }
export interface FieldChange { label: string; from: string; to: string }
export interface LateEdit { id: string; at: string; actorId: string | null; sheetId: string; box: string | null; deleted: boolean; changes: FieldChange[] }

const LABEL: Record<string, string> = {
  ...Object.fromEntries(STOP_FIELDS.map((f) => [f.key, f.short])),
  ...Object.fromEntries(COMP_FIELDS.map((f) => [f.key, f.label])),
  ...Object.fromEntries(WH_FIELDS.map((f) => [f.key, f.label])),
  ...Object.fromEntries(RET_FIELDS.map((f) => [f.key, `Leadott ${f.label}`])),
  damaged: 'ÉK/NHB/törölt (régi)', note: 'Megjegyzés', comp_note: 'Komplikáció megjegyzés', wh_note: 'Raktári megjegyzés',
  end_time: 'Végzés', start_time: 'Kezdés', status: 'Állapot', submitted_at: 'Lezárva', box_code: 'Box kód', box_name: 'Box neve', seq: 'Sorrend', done_at: 'Leadva',
}
const SKIP = new Set(['id', 'sheet_id', 'workspace_id', 'user_id', 'car_id', 'work_date', 'created_at', 'updated_at', 'box_id'])
const fmt = (v: unknown): string => (v == null || v === '' ? '—' : v === 'submitted' ? 'Lezárva' : v === 'draft' ? 'Piszkozat' : typeof v === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(v) ? v.slice(0, 5) : String(v))

export function diffFields(oldRow: Record<string, unknown> | null, newRow: Record<string, unknown> | null): FieldChange[] {
  if (!oldRow || !newRow) return []
  const keys = [...new Set([...Object.keys(oldRow), ...Object.keys(newRow)])].filter((k) => !SKIP.has(k))
  return keys.filter((k) => String(oldRow[k] ?? '') !== String(newRow[k] ?? '')).map((k) => ({ label: LABEL[k] ?? k, from: fmt(oldRow[k]), to: fmt(newRow[k]) }))
}

// Csak az utólagos bejegyzések, lapra bontva, időrendben
export function lateEdits(rows: AuditRow[]): LateEdit[] {
  const out: LateEdit[] = []
  for (const r of rows) {
    const d = r.detail ?? {}
    if (d.late !== true) continue
    const sheetId = String(d.sheet_id ?? r.entity_id ?? '')
    if (!sheetId) continue
    const deleted = r.action === 'DELETE'
    const changes = deleted ? [] : diffFields(d.old as Record<string, unknown> | null, d.new as Record<string, unknown> | null)
    if (!deleted && changes.length === 0) continue
    out.push({ id: r.id, at: r.created_at, actorId: r.actor_id, sheetId, box: r.entity === 'box_sheet_stops' ? (typeof d.box_code === 'string' ? d.box_code : null) ?? 'box' : null, deleted, changes })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}
export function lateEditsBySheet(rows: AuditRow[]): Map<string, LateEdit[]> {
  const m = new Map<string, LateEdit[]>()
  for (const e of lateEdits(rows)) { if (!m.has(e.sheetId)) m.set(e.sheetId, []); m.get(e.sheetId)!.push(e) }
  return m
}
