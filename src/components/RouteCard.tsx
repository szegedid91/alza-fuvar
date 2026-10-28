import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useRoutes } from '../hooks/useRoutes'
import { useRouteStops } from '../hooks/useRouteStops'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { todayISO } from '../lib/labels'
import { getNavApp, setNavApp, navUrl, NAV_LABEL, type NavApp } from '../lib/nav'
import { toast } from '../lib/toast'
import Icon from './Icon'

// A futár mai járata(i): a beosztásban hozzárendelt járat boxai sorrendben,
// „hanyadik cím” számlálóval, egy koppintásos navigációval (Google Maps / Waze —
// a választás a telefonon marad). A haladás az adatbázisban van (autó + járat +
// kör + nap), így másik telefonról / a páros másik tagjánál is ugyanott tart.
export default function RouteCard() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const date = todayISO()
  const { data: routes } = useRoutes()
  const { data: stopsByRoute } = useRouteStops()
  const [navApp, setNav] = useState<NavApp>(getNavApp)
  // A vezető módosítása (boxok, sorrend) és a páros másik tagjának lépése azonnal ideér
  useRealtimeInvalidate(currentWorkspaceId, ['route_stops', 'route_runs', 'shifts'], [['route-stops'], ['route-runs'], ['my-routes-today']])
  const [openList, setOpenList] = useState(false)

  const { data: myShifts } = useQuery({
    queryKey: ['my-routes-today', currentWorkspaceId, profile?.id, date],
    enabled: !!currentWorkspaceId && !!profile?.id,
    refetchInterval: 60000,
    queryFn: async () => {
      const uid = profile!.id
      const [{ data: shifts, error }, { data: cars, error: carErr }] = await Promise.all([
        supabase.from('shifts').select('id, car_id, round, route_id')
          .eq('workspace_id', currentWorkspaceId!).eq('work_date', date).not('route_id', 'is', null)
          .or(`driver_id.eq.${uid},loader_id.eq.${uid},trainee_id.eq.${uid}`).order('round'),
        supabase.from('cars').select('id, plate').eq('workspace_id', currentWorkspaceId!),
      ])
      if (error) throw error
      if (carErr) throw carErr
      const plates = new Map((cars ?? []).map((c) => [c.id, c.plate]))
      return (shifts ?? []).map((s) => ({ ...s, route_id: s.route_id!, round: s.round ?? 1, plate: plates.get(s.car_id) ?? '?' }))
    },
  })
  const { data: runs } = useQuery({
    queryKey: ['route-runs', currentWorkspaceId, date],
    enabled: !!currentWorkspaceId && (myShifts?.length ?? 0) > 0,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.from('route_runs').select('route_id, round, car_id, current_index')
        .eq('workspace_id', currentWorkspaceId!).eq('work_date', date)
      if (error) throw error
      return data ?? []
    },
  })
  const setIndex = useMutation({
    mutationFn: async ({ routeId, round, carId, index }: { routeId: string; round: number; carId: string; index: number }) => {
      const { error } = await supabase.from('route_runs').upsert(
        { workspace_id: currentWorkspaceId!, work_date: date, route_id: routeId, round, car_id: carId, current_index: index, updated_by: profile!.id, updated_at: new Date().toISOString() },
        { onConflict: 'work_date,route_id,round,car_id' },
      )
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['route-runs'] }),
    onError: (e) => toast.error('Nem sikerült menteni: ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })

  if (!myShifts || myShifts.length === 0) return null
  const codeOf = (id: string) => routes?.find((r) => r.id === id)?.code ?? '?'
  const pickNav = (app: NavApp) => { setNavApp(app); setNav(app) }

  return (
    <>
      {myShifts.map((sh) => {
        const stops = stopsByRoute?.get(sh.route_id) ?? []
        const run = runs?.find((r) => r.route_id === sh.route_id && r.round === sh.round && r.car_id === sh.car_id)
        const idx = Math.min(run?.current_index ?? 0, stops.length)
        const done = idx >= stops.length && stops.length > 0
        const cur = stops[idx]
        const go = (index: number) => setIndex.mutate({ routeId: sh.route_id, round: sh.round, carId: sh.car_id, index })
        return (
          <div key={sh.id} className="card stack" style={{ gap: 10, borderColor: 'var(--primary)' }}>
            <div className="between">
              <div className="card-title" style={{ margin: 0 }}><Icon name="map" />{codeOf(sh.route_id)} járat{sh.round === 2 ? ' · 2. kör' : ''}</div>
              <span className="badge num">{sh.plate}</span>
            </div>
            {stops.length === 0 ? (
              <div className="tiny muted">Ehhez a járathoz még nincsenek boxok rendelve — a vezető a Beosztás oldalon, a „Járatok” kártyán adja meg.</div>
            ) : done ? (
              <div className="stack" style={{ gap: 6 }}>
                <div className="badge success" style={{ alignSelf: 'flex-start' }}><Icon name="check-circle" />Mind a {stops.length} cím kész</div>
                <button type="button" className="btn ghost sm auto" disabled={setIndex.isPending} onClick={() => go(stops.length - 1)}><Icon name="arrow-left" size={14} />Vissza az utolsóra</button>
              </div>
            ) : cur ? (
              <>
                <div className="between" style={{ alignItems: 'baseline' }}>
                  <span className="small muted">{idx + 1}. cím a {stops.length}-ből</span>
                  <span className="tiny muted">{stops.length - idx - 1} van hátra</span>
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>{cur.box.code ? `${cur.box.code} · ` : ''}{cur.box.name}</div>
                  <div className="small muted">{cur.box.address}</div>
                  {cur.box.description && <div className="tiny muted" style={{ marginTop: 4 }}><Icon name="info" size={12} />{cur.box.description}</div>}
                </div>
                {cur.box.lat != null && cur.box.lng != null ? (
                  <a className="btn" href={navUrl(navApp, cur.box.lat, cur.box.lng)} target="_blank" rel="noopener noreferrer">
                    <Icon name="navigation" />Navigálás ({NAV_LABEL[navApp]})
                  </a>
                ) : <div className="tiny muted">Ehhez a boxhoz nincs koordináta a jegyzékben.</div>}
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn ghost sm" disabled={setIndex.isPending || idx === 0} onClick={() => go(idx - 1)} style={{ flex: 1 }}><Icon name="arrow-left" size={14} />Előző</button>
                  <button type="button" className="btn secondary sm" disabled={setIndex.isPending} onClick={() => go(idx + 1)} style={{ flex: 2 }}><Icon name="check" size={14} />Kész, következő</button>
                </div>
              </>
            ) : null}
            {stops.length > 0 && (
              <>
                <div className="between">
                  <div className="row" style={{ gap: 4 }}>
                    <span className="tiny muted">Navigáció:</span>
                    {(['google', 'waze'] as NavApp[]).map((a) => (
                      <button key={a} type="button" className={`badge ${navApp === a ? 'primary' : ''}`} style={{ cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: 700, minHeight: 26 }} onClick={() => pickNav(a)}>{NAV_LABEL[a]}</button>
                    ))}
                  </div>
                  <button type="button" className="link-btn tiny" style={{ whiteSpace: 'nowrap' }} onClick={() => setOpenList((o) => !o)}>{openList ? 'lista elrejtése' : 'teljes lista'}</button>
                </div>
                {openList && (
                  <div className="stack" style={{ gap: 4 }}>
                    {stops.map((s, i) => (
                      <button key={s.id} type="button" className="row" disabled={setIndex.isPending} onClick={() => go(i)}
                        style={{ gap: 6, alignItems: 'center', background: i === idx ? 'var(--primary-ghost)' : 'none', border: 'none', borderRadius: 6, padding: '4px 6px', color: 'inherit', textAlign: 'left', cursor: 'pointer', opacity: i < idx ? 0.6 : 1 }}>
                        <Icon name={i < idx ? 'check-circle' : i === idx ? 'navigation' : 'map-pin'} size={14} style={{ color: i < idx ? 'var(--success)' : i === idx ? 'var(--primary)' : 'var(--text-dim)' }} />
                        <span className="tiny" style={{ flex: 1, textDecoration: i < idx ? 'line-through' : 'none' }}>{i + 1}. {s.box.code ? `${s.box.code} · ` : ''}{s.box.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
    </>
  )
}
