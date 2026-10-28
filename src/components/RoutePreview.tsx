import { useState } from 'react'
import { useRoutes } from '../hooks/useRoutes'
import { useRouteStops } from '../hooks/useRouteStops'
import { getNavApp, setNavApp, type NavApp } from '../lib/nav'
import { RouteCardView } from './RouteCard'
import Icon from './Icon'

// Vezetői előnézet: pontosan az a kártya, amit a futár a kezdőlapján kap, ha ez a
// járat van ráosztva — a haladás csak itt, helyben lépked (nem íródik az adatbázisba).
export default function RoutePreview() {
  const { data: routes } = useRoutes()
  const { data: stopsByRoute } = useRouteStops()
  const [routeId, setRouteId] = useState('')
  const [round, setRound] = useState(1)
  const [idx, setIdx] = useState(0)
  const [navApp, setNav] = useState<NavApp>(getNavApp)
  const [openList, setOpenList] = useState(false)
  const route = routes?.find((r) => r.id === routeId) ?? null
  const stops = route ? stopsByRoute?.[route.id] ?? [] : []
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="card-title" style={{ margin: 0 }}><Icon name="eye" />Futár-nézet előnézet</div>
      <p className="tiny muted" style={{ margin: 0 }}>Így látja a futár a kezdőlapján, ha a beosztásban ez a járat van ráosztva. A „Kész, következő” itt csak az előnézetben lépked, a navigálás gomb élesben nyit.</p>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <select className="select" value={routeId} onChange={(e) => { setRouteId(e.target.value); setIdx(0); setOpenList(false) }} style={{ flex: 1, minWidth: 140 }}>
          <option value="">— járat —</option>
          {(routes ?? []).map((r) => <option key={r.id} value={r.id}>{r.code}{r.is_relief ? ' (mentesítő)' : ''} · {(stopsByRoute?.[r.id] ?? []).length} box</option>)}
        </select>
        <select className="select" value={round} onChange={(e) => setRound(Number(e.target.value))} style={{ width: 110 }}>
          <option value={1}>1. kör</option>
          <option value={2}>2. kör</option>
        </select>
      </div>
      {route && (
        <RouteCardView code={route.code} round={round} plate="MINTA" stops={stops} idx={Math.min(idx, stops.length)}
          go={(i) => setIdx(Math.max(0, Math.min(i, stops.length)))} navApp={navApp} pickNav={(a) => { setNavApp(a); setNav(a) }}
          openList={openList} setOpenList={(f) => setOpenList(f)} />
      )}
    </div>
  )
}
