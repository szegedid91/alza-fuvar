import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatDate, formatHuf, adjustmentTypeLabel } from '../lib/labels'
import type { Enums } from '../lib/database.types'

type Summary = {
  shifts: { date: string; plate: string; round: number; role: string }[]
  check_ins: { date: string; plate: string }[]
  adjustments: { date: string; type: Enums<'adjustment_type'>; amount: number }[]
  fuel: number; inspections: number; incidents: number; issues: number; box_sheets: number
}

// Törlés előtt tételesen: melyik napokon van beosztva, mely napokon dolgozott (becsekkolás),
// milyen bér-tételei vannak — hogy a vezető lássa, pontosan mi veszne el.
export default function MemberDataSummary({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['member-data-summary', userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('member_data_summary', { target_id: userId })
      if (error) throw error
      return data as unknown as Summary | null
    },
  })
  if (isLoading) return <div className="tiny muted">Adatok összegyűjtése…</div>
  if (!data) return null
  const d = (iso: string) => formatDate(iso).replace(/^\d{4}\.\s*/, '')
  const today = new Date().toISOString().slice(0, 10)
  const future = data.shifts.filter((s) => s.date >= today)
  const list = (items: string[], max = 14) => items.slice(0, max).join(', ') + (items.length > max ? ` … (+${items.length - max})` : '')
  return (
    <div className="stack" style={{ gap: 6, fontSize: 13 }}>
      {data.shifts.length > 0 && (
        <div>
          <strong>Beosztás: {data.shifts.length} nap{future.length ? ` (ebből ${future.length} jövőbeli)` : ''}</strong>
          <div className="tiny muted">{list(data.shifts.map((s) => `${d(s.date)} ${s.plate} (${s.role}${s.round === 2 ? ', 2. kör' : ''})`))}</div>
        </div>
      )}
      {data.check_ins.length > 0 && (
        <div>
          <strong>Munkanapok (becsekkolás): {data.check_ins.length}</strong>
          <div className="tiny muted">{list(data.check_ins.map((c) => `${d(c.date)} ${c.plate}`))}</div>
        </div>
      )}
      {data.adjustments.length > 0 && (
        <div>
          <strong>Bér-tételek: {data.adjustments.length}</strong>
          <div className="tiny muted">{list(data.adjustments.map((a) => `${d(a.date)} ${adjustmentTypeLabel[a.type] ?? a.type} ${formatHuf(a.amount)}`))}</div>
        </div>
      )}
      {(data.fuel > 0 || data.inspections > 0 || data.incidents > 0 || data.issues > 0 || data.box_sheets > 0) && (
        <div className="tiny muted">
          {[data.fuel > 0 && `${data.fuel} tankolás`, data.inspections > 0 && `${data.inspections} autó-ellenőrzés`, data.box_sheets > 0 && `${data.box_sheets} Box-lap`,
            data.incidents > 0 && `${data.incidents} esemény`, data.issues > 0 && `${data.issues} hibabejelentés`].filter(Boolean).join(' · ')}
        </div>
      )}
      {data.shifts.length === 0 && data.check_ins.length === 0 && data.adjustments.length === 0 && data.fuel + data.inspections + data.incidents + data.issues + data.box_sheets === 0 && (
        <div className="tiny muted">Nincs hozzá tartozó beosztás, munkanap vagy bér-adat.</div>
      )}
    </div>
  )
}
