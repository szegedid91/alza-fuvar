import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { useRoutes } from '../hooks/useRoutes'
import { useRouteStops } from '../hooks/useRouteStops'
import { resolveNames } from '../lib/names'
import { todayISO } from '../lib/labels'
import Icon from './Icon'

// Vezetői nézet: a mai járatok (beosztásból), ki viszi, és hanyadik címnél tart
// a futár — a route_runs haladásból, realtime frissülve
export default function RouteProgressCard() {
  const { currentWorkspaceId } = useWorkspace()
  const date = todayISO()
  const { data: routes } = useRoutes()
  const { data: stopsByRoute } = useRouteStops()
  useRealtimeInvalidate(currentWorkspaceId, ['route_runs', 'shifts'], [['route-progress']])
  const { data } = useQuery({
    queryKey: ['route-progress', currentWorkspaceId, date],
    enabled: !!currentWorkspaceId,
    refetchInterval: 30000,
    queryFn: async () => {
      const [{ data: shifts, error }, { data: runs, error: runErr }, { data: cars, error: carErr }] = await Promise.all([
        supabase.from('shifts').select('id, car_id, round, route_id, driver_id, loader_id, trainee_id')
          .eq('workspace_id', currentWorkspaceId!).eq('work_date', date).not('route_id', 'is', null).order('round'),
        supabase.from('route_runs').select('route_id, round, car_id, current_index, updated_at')
          .eq('workspace_id', currentWorkspaceId!).eq('work_date', date),
        supabase.from('cars').select('id, plate').eq('workspace_id', currentWorkspaceId!),
      ])
      if (error) throw error
      if (runErr) throw runErr
      if (carErr) throw carErr
      const names = await resolveNames((shifts ?? []).flatMap((s) => [s.driver_id, s.loader_id, s.trainee_id]))
      const plates = new Map((cars ?? []).map((c) => [c.id, c.plate]))
      return (shifts ?? []).map((s) => ({
        id: s.id, routeId: s.route_id!, round: s.round ?? 1, carId: s.car_id, plate: plates.get(s.car_id) ?? '?',
        crew: [s.driver_id, s.loader_id].filter((x): x is string => !!x).map((id) => names[id] ?? '?').join(' + ')
          + (s.trainee_id ? ` + betanuló: ${names[s.trainee_id] ?? '?'}` : ''),
        run: (runs ?? []).find((r) => r.route_id === s.route_id && r.round === (s.round ?? 1) && r.car_id === s.car_id) ?? null,
      }))
    },
  })
  if (!data || data.length === 0) return null
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
  const codeOf = (id: string) => routes?.find((r) => r.id === id)?.code ?? '?'
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="card-title" style={{ margin: 0 }}><Icon name="map" />Járatok ma ({data.length})</div>
      {data.map((s) => {
        const stops = stopsByRoute?.[s.routeId] ?? []
        const idx = Math.min(s.run?.current_index ?? 0, stops.length)
        const done = stops.length > 0 && idx >= stops.length
        const cur = stops[idx]
        const pct = stops.length ? Math.round((idx / stops.length) * 100) : 0
        return (
          <div key={s.id} className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div className="between" style={{ gap: 8 }}>
              <span className="small" style={{ fontWeight: 700, minWidth: 0 }}>
                {codeOf(s.routeId)} járat{s.round === 2 ? ' · 2. kör' : ''} <span className="num muted" style={{ fontWeight: 500 }}>· {s.plate}</span>
              </span>
              {stops.length === 0
                ? <span className="badge">nincs box a járaton</span>
                : done
                  ? <span className="badge success"><Icon name="check-circle" />kész ({stops.length} cím)</span>
                  : <span className={`badge ${s.run ? 'primary' : ''}`}>{s.run ? `${idx + 1}. cím a ${stops.length}-ből` : `még nem indult · ${stops.length} cím`}</span>}
            </div>
            <div className="tiny muted">{s.crew || '— nincs beosztva —'}</div>
            {stops.length > 0 && (
              <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-elev-2)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: done ? 'var(--success)' : 'var(--primary)' }} />
              </div>
            )}
            {cur && !done && (
              <div className="tiny" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span><Icon name="navigation" size={12} />{cur.box.code ? `${cur.box.code} · ` : ''}{cur.box.name}</span>
                {s.run?.updated_at && <span className="muted">· lépett {hhmm(s.run.updated_at)}</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
