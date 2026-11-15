// A helyi sorban (outbox) álló, még fel nem küldött írások ráolvasztása a szerverről jött adatra.
// Így térerő nélkül is azt látja a futár, amit beírt — és egy közbeeső frissítés sem tünteti el.
import type { BoxStop } from './boxSheet'

export interface QueuedRec {
  table: string; op: 'insert' | 'update'
  values: Record<string, unknown>; match?: Record<string, unknown>
  createdAt: number; seq?: number
}
const ordered = (q: QueuedRec[]) => [...q].sort((a, b) => a.createdAt - b.createdAt || (a.seq ?? 0) - (b.seq ?? 0))

const EMPTY_STOP = {
  box_id: null, box_code: null, box_name: null, done_at: null, note: null,
  placed: 0, missorted: 0, nf: 0, oversize: 0, shortage: 0, returned: 0, damaged: 0, invalid_code: 0, do_not_place: 0, cancelled: 0, left_on_car: 0,
}

// Box-lap megállók: a szerver listája + a sorban álló felvételek (ennek a lapnak; null = bármelyik) + a sorban álló módosítások
export function mergeQueuedStops(server: BoxStop[], queued: QueuedRec[], sheetId: string | null): BoxStop[] {
  const out = server.map((s) => ({ ...s }))
  for (const r of ordered(queued.filter((q) => q.table === 'box_sheet_stops'))) {
    if (r.op === 'insert') {
      const v = r.values as Partial<BoxStop>
      if (!v.id || (sheetId && v.sheet_id !== sheetId) || out.some((s) => s.id === v.id)) continue
      out.push({ ...EMPTY_STOP, created_at: new Date(r.createdAt).toISOString(), seq: out.length + 1, ...v } as BoxStop)
    } else {
      const i = out.findIndex((s) => s.id === r.match?.id)
      if (i >= 0) out[i] = { ...out[i], ...(r.values as Partial<BoxStop>) }
    }
  }
  return out
}

// Kitöltöttnek számít a megálló, ha van benne szám vagy megjegyzés (a járat ettől léphet tovább)
type StopCounts = Pick<BoxStop, 'placed' | 'missorted' | 'nf' | 'oversize' | 'shortage' | 'returned' | 'damaged' | 'invalid_code' | 'do_not_place' | 'cancelled' | 'left_on_car' | 'note'>
export function isStopFilled(s: Partial<StopCounts>): boolean {
  const n = (v: number | null | undefined) => Number(v ?? 0)
  return n(s.placed) + n(s.missorted) + n(s.nf) + n(s.oversize) + n(s.shortage) + n(s.returned) + n(s.damaged) + n(s.invalid_code) + n(s.do_not_place) + n(s.cancelled) + n(s.left_on_car) > 0 || !!s.note?.trim()
}

// Járat-állás: a szerver sorai + a sorban álló léptetések (az utolsó nyer járat + kör + autó szerint)
export interface RunRow { route_id: string; round: number; car_id: string; current_index: number; current_stop_id: string | null; current_box_id: string | null }
export function mergeQueuedRuns(server: RunRow[], queued: QueuedRec[], date: string): RunRow[] {
  const out = server.map((r) => ({ ...r }))
  for (const q of ordered(queued.filter((x) => x.table === 'route_runs' && x.op === 'insert'))) {
    const v = q.values as Partial<RunRow> & { work_date?: string }
    if (v.work_date !== date || !v.route_id || v.round == null || !v.car_id || v.current_index == null) continue
    const row: RunRow = { route_id: v.route_id, round: v.round, car_id: v.car_id, current_index: v.current_index, current_stop_id: v.current_stop_id ?? null, current_box_id: v.current_box_id ?? null }
    const i = out.findIndex((r) => r.route_id === row.route_id && r.round === row.round && r.car_id === row.car_id)
    if (i >= 0) out[i] = row; else out.push(row)
  }
  return out
}
