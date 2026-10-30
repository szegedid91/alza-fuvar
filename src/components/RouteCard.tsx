import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useRoutes } from '../hooks/useRoutes'
import { useRouteStops, type RouteStop } from '../hooks/useRouteStops'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { todayISO } from '../lib/labels'
import { getNavApp, navUrl, NAV_LABEL, type NavApp } from '../lib/nav'
import { depotOf, type Depot } from '../lib/depot'
import { toast } from '../lib/toast'
import { Link, useNavigate } from 'react-router-dom'
import Icon from './Icon'
import BoxCard from './BoxCard'

// A futár mai járata(i): a beosztásban hozzárendelt járat boxai sorrendben,
// „hanyadik cím” számlálóval, egy koppintásos navigációval (Google Maps / Waze —
// a választás a telefonon marad). A haladás az adatbázisban van (autó + járat +
// kör + nap), így másik telefonról / a páros másik tagjánál is ugyanott tart.
export default function RouteCard() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const qc = useQueryClient()
  const date = todayISO()
  const depot = depotOf(currentWorkspace)
  const { data: routes } = useRoutes()
  const { data: stopsByRoute } = useRouteStops()
  const navApp: NavApp = getNavApp()
  // A vezető módosítása (boxok, sorrend) és a páros másik tagjának lépése azonnal ideér
  useRealtimeInvalidate(currentWorkspaceId, ['route_stops', 'route_runs', 'shifts', 'box_sheet_stops'], [['route-stops'], ['route-runs'], ['my-routes-today'], ['box-sheet-filled']])
  const navigate = useNavigate()
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
  // A mai Box-lapomon kitöltött boxok: a kártyán jelezzük, melyik boxhoz van már sor (a lap csak eltérésnél kell)
  const { data: filledBoxes } = useQuery({
    queryKey: ['box-sheet-filled', currentWorkspaceId, profile?.id, date],
    enabled: !!currentWorkspaceId && !!profile?.id,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.from('box_sheet_stops')
        .select('box_id, placed, missorted, nf, oversize, shortage, returned, damaged, left_on_car, note, sheet:box_sheets!inner(user_id, work_date)')
        .eq('workspace_id', currentWorkspaceId!).eq('sheet.user_id', profile!.id).eq('sheet.work_date', date)
      if (error) throw error
      const filled = (data ?? []).filter((r) => (r.placed ?? 0) + (r.missorted ?? 0) + (r.nf ?? 0) + (r.oversize ?? 0) + (r.shortage ?? 0) + (r.returned ?? 0) + (r.damaged ?? 0) + (r.left_on_car ?? 0) > 0 || !!r.note?.trim())
      return filled.map((r) => r.box_id).filter((x): x is string => !!x)
    },
  })
  const setIndex = useMutation({
    mutationFn: async ({ routeId, round, carId, index, done }: { routeId: string; round: number; carId: string; index: number; done?: { boxId: string; stopIndex: number }[] }) => {
      const { error } = await supabase.from('route_runs').upsert(
        { workspace_id: currentWorkspaceId!, work_date: date, route_id: routeId, round, car_id: carId, current_index: index, updated_by: profile!.id, updated_at: new Date().toISOString() },
        { onConflict: 'work_date,route_id,round,car_id' },
      )
      if (error) throw error
      // Előre lépéskor naplózzuk: ebben a boxban ekkor adott le mindent a futár (a vezető az Áttekintésben látja)
      if (done?.length) {
        const { error: logErr } = await supabase.from('route_stop_logs').insert(done.map((d) => ({
          workspace_id: currentWorkspaceId!, work_date: date, route_id: routeId, round, car_id: carId, user_id: profile!.id, box_id: d.boxId, stop_index: d.stopIndex,
        })))
        if (logErr) throw logErr
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['route-runs'] }),
    onError: (e) => toast.error('Nem sikerült menteni: ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })

  if (!myShifts || myShifts.length === 0) return null
  const codeOf = (id: string) => routes?.find((r) => r.id === id)?.code ?? '?'

  return (
    <>
      {myShifts.map((sh) => {
        const stops = stopsByRoute?.[sh.route_id] ?? []
        const run = runs?.find((r) => r.route_id === sh.route_id && r.round === sh.round && r.car_id === sh.car_id)
        const idx = Math.min(run?.current_index ?? 0, stops.length)
        const go = (index: number) => {
          // ami az aktuális és az új hely között van, az leadva (általában egy box)
          const done = index > idx ? stops.slice(idx, index).map((s, k) => ({ boxId: s.box_id, stopIndex: idx + k + 1 })) : []
          setIndex.mutate({ routeId: sh.route_id, round: sh.round, carId: sh.car_id, index, done })
        }
        return (
          <RouteCardView key={sh.id} code={codeOf(sh.route_id)} round={sh.round} plate={sh.plate} stops={stops} idx={idx} busy={setIndex.isPending}
            go={go} navApp={navApp} openList={openList} setOpenList={setOpenList} depot={depot}
            sheetFilled={!!stops[idx] && (filledBoxes ?? []).includes(stops[idx].box_id)} onFillSheet={() => navigate(`/box-lap?box=${stops[idx]?.box_id ?? ''}`)} />
        )
      })}
    </>
  )
}

// A járat-kártya megjelenése (egy járat egy körön)
function RouteCardView({ code, round, plate, stops, idx, busy = false, go, navApp, openList, setOpenList, depot, sheetFilled = true, onFillSheet }: {
  code: string; round: number; plate: string; stops: RouteStop[]; idx: number; busy?: boolean
  go: (index: number) => void; navApp: NavApp; openList: boolean; setOpenList: (f: (o: boolean) => boolean) => void
  // A raktár: az utolsó box után ide navigál a futár (az admin állítja a Járatok oldalon)
  depot: Depot
  // Box-lap csak eltérésnél: a „Kész, következő” mindig mehet; ha ehhez a boxhoz már van sor a mai lapon, jelezzük
  sheetFilled?: boolean; onFillSheet?: () => void
}) {
  const done = idx >= stops.length && stops.length > 0
  const cur = stops[idx]
  // A box adatlapja (fotó, „hol található” leírás, megjegyzés) a navigálás mellett egy koppintásra
  const [showBox, setShowBox] = useState(false)
  useEffect(() => { setShowBox(false) }, [idx])
  return (
          <div className="card stack" style={{ gap: 10, borderColor: 'var(--primary)' }}>
            <div className="between">
              <div className="card-title" style={{ margin: 0 }}><Icon name="map" />{code} járat{round === 2 ? ' · 2. kör' : ''}</div>
              <span className="badge num">{plate}</span>
            </div>
            {stops.length === 0 ? (
              <div className="tiny muted">Ehhez a járathoz még nincsenek boxok rendelve — a vezető a Beosztás oldalon, a „Járatok” kártyán adja meg.</div>
            ) : done ? (
              <div className="stack" style={{ gap: 6 }}>
                <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--primary-ghost)', border: '1px solid var(--success)' }}>
                  <div style={{ fontWeight: 800, fontSize: 17 }}><Icon name="truck" /> Kész — irány a raktár!</div>
                  <div className="tiny muted">Mind a {stops.length} cím leadva. A raktárban: „Elszámoltam” a visszáruk leadásakor, majd a Box-lap nap végi része és a kijelentkezés.</div>
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}><Icon name="warehouse" size={18} /> {depot.name}</div>
                  {depot.address ? <div className="small muted">{depot.address}</div> : <div className="tiny muted">A raktár címét az admin a Járatok oldalon adhatja meg.</div>}
                </div>
                <a className="btn" href={navUrl(navApp, depot.lat, depot.lng)} target="_blank" rel="noopener noreferrer">
                  <Icon name="navigation" />Navigálás a raktárba ({NAV_LABEL[navApp]})
                </a>
                <button type="button" className="btn ghost sm auto" disabled={busy} onClick={() => go(stops.length - 1)}><Icon name="arrow-left" size={14} />Vissza az utolsóra</button>
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
                  {cur.box.notes && <div className="small" style={{ marginTop: 6, padding: '6px 8px', borderRadius: 8, background: 'var(--warning-ghost, rgba(245,158,11,0.12))', color: 'var(--warning)', fontWeight: 600 }}><Icon name="key" size={14} />{cur.box.notes}</div>}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {cur.box.lat != null && cur.box.lng != null ? (
                    <a className="btn" style={{ flex: 2 }} href={navUrl(navApp, cur.box.lat, cur.box.lng)} target="_blank" rel="noopener noreferrer">
                      <Icon name="navigation" />Navigálás ({NAV_LABEL[navApp]})
                    </a>
                  ) : <div className="tiny muted" style={{ flex: 2 }}>Ehhez a boxhoz nincs koordináta a jegyzékben.</div>}
                  <button type="button" className={`btn ${showBox ? 'secondary' : 'ghost'}`} style={{ flex: 1 }} onClick={() => setShowBox((o) => !o)} aria-expanded={showBox}>
                    <Icon name="package" />Box
                  </button>
                </div>
                {showBox && <BoxCard box={cur.box} onClose={() => setShowBox(false)} hideNav />}
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn ghost sm" disabled={busy || idx === 0} onClick={() => go(idx - 1)} style={{ flex: 1 }}><Icon name="arrow-left" size={14} />Előző</button>
                  <button type="button" className="btn secondary sm" disabled={busy} onClick={() => go(idx + 1)} style={{ flex: 2 }}><Icon name="check" size={14} />Kész, következő</button>
                </div>
                {onFillSheet && (sheetFilled
                  ? <div className="tiny muted"><Icon name="check-circle" size={12} style={{ color: 'var(--success)' }} /> Ehhez a boxhoz van sor a mai Box-lapon. <button type="button" className="link-btn tiny" style={{ padding: 0 }} onClick={onFillSheet}>Megnyitás</button></div>
                  : <button type="button" className="btn ghost sm" style={{ borderColor: 'var(--warning)' }} onClick={onFillSheet}>
                      <Icon name="clipboard" size={16} />Volt eltérés? Box-lap ehhez a boxhoz
                    </button>)}
                {!sheetFilled && <div className="tiny muted">Ha minden csomag rendben a helyére került, nem kell lapot tölteni és fotózni — mehetsz tovább. Box-lap csak eltérésnél (hiány, NF, rossz szortírozás, visszáru, ÉK/NHB…).</div>}
              </>
            ) : null}
            {stops.length > 0 && (
              <>
                <div className="between">
                  <span className="tiny muted">Navigáció: {NAV_LABEL[navApp]} · <Link to="/profil" style={{ color: 'inherit' }}>a Profilban módosítható</Link></span>
                  <button type="button" className="link-btn tiny" style={{ whiteSpace: 'nowrap' }} onClick={() => setOpenList((o) => !o)}>{openList ? 'lista elrejtése' : 'teljes lista'}</button>
                </div>
                {openList && (
                  <div className="stack" style={{ gap: 4 }}>
                    {stops.map((s, i) => (
                      <button key={s.id} type="button" className="row" disabled={busy} onClick={() => go(i)}
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
}
