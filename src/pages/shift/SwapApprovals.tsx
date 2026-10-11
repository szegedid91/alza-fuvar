import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { resolveNames } from '../../lib/names'
import { formatDate, formatDateTime } from '../../lib/labels'
import Icon from '../../components/Icon'

// Függő műszakcsere-kérések — a menedzser dönt, akár aznap
export default function SwapApprovals({ workspaceId }: { workspaceId: string | null }) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const { data: pending } = useQuery({
    queryKey: ['swap-pending', workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('swap_requests')
        .select('*, shift:shifts(work_date, driver_id, loader_id, car:cars(plate))')
        .eq('workspace_id', workspaceId!)
        .eq('status', 'pending')
        .order('created_at')
      if (error) throw error
      const rows = data ?? []
      const shiftOf = (r: (typeof rows)[number]) =>
        r.shift as unknown as { work_date: string; driver_id: string | null; loader_id: string | null; car: { plate: string } | null } | null
      const names = await resolveNames(rows.flatMap((r) => [r.requested_by, r.partner_id, shiftOf(r)?.driver_id, shiftOf(r)?.loader_id]))
      return rows.map((r) => ({ ...r, _shift: shiftOf(r), _names: names }))
    },
  })

  async function decide(id: string, approve: boolean) {
    setError(null)
    const { error } = await supabase.rpc('decide_swap', { p_request_id: id, p_approve: approve })
    if (error) { setError(error.message); return }
    await qc.invalidateQueries({ queryKey: ['swap-pending'] })
    await qc.invalidateQueries({ queryKey: ['shift-cal'] })
    // A heti táblázat és a "ma" nézet is az érintett shiftet mutatja
    await qc.invalidateQueries({ queryKey: ['shift-week'] })
    await qc.invalidateQueries({ queryKey: ['today'] })
  }

  if ((pending?.length ?? 0) === 0) return null
  return (
    <div className="card stack" style={{ borderColor: 'var(--warning)' }}>
      <div className="card-title"><Icon name="repeat" style={{ color: 'var(--warning)' }} />Függő cserekérések ({pending!.length})</div>
      {error && <div className="alert error">{error}</div>}
      {pending!.map((r) => {
        const s = r._shift
        const names = r._names as Record<string, string>
        return (
          <div key={r.id} className="stack" style={{ gap: 6 }}>
            <div>
              <div className="small" style={{ fontWeight: 700 }}>
                {s ? `${formatDate(s.work_date)} · ${s.car?.plate ?? '?'}` : 'Ismeretlen beosztás'}
              </div>
              <div className="tiny muted">Kérte: {names[r.requested_by] ?? '?'} · {formatDateTime(r.created_at)}</div>
              {s && (
                <div className="tiny muted">
                  Sofőr: {s.driver_id ? names[s.driver_id] ?? '?' : '—'} ↔ Rakodó: {s.loader_id ? names[s.loader_id] ?? '?' : '—'}
                </div>
              )}
              {r.partner_id && (
                <span className={`badge ${r.partner_decision === 'approved' ? 'success' : r.partner_decision === 'rejected' ? 'danger' : 'warning'}`} style={{ marginTop: 4 }}>
                  Társ ({names[r.partner_id] ?? '?'}): {r.partner_decision === 'approved' ? '✔ elfogadta' : r.partner_decision === 'rejected' ? '✖ elutasította' : 'még nem döntött'}
                </span>
              )}
            </div>
            <div className="btn-grid">
              <button className="btn danger sm" onClick={() => void decide(r.id, false)}>Elutasítás</button>
              <button className="btn sm" onClick={() => void decide(r.id, true)}>Csere jóváhagyása</button>
            </div>
            {r.partner_decision !== 'approved' && (
              <p className="tiny muted" style={{ margin: 0 }}>A társ jóváhagyása nélkül is átteheted — a te döntésed a végső.</p>
            )}
            <div className="divider" />
          </div>
        )
      })}
    </div>
  )
}
