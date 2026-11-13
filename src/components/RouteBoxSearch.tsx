import { useMemo, useState } from 'react'
import { useAlzaBoxes } from '../hooks/useAlzaBoxes'
import { useRoutes } from '../hooks/useRoutes'
import { useRouteStops } from '../hooks/useRouteStops'
import { findBoxInRoutes } from '../lib/routeLookup'
import { hm } from '../lib/routeHistory'
import Icon from './Icon'

// Box keresése a járatokban: kód / név / cím → melyik járat hanyadik címe (tervezett érkezéssel)
export default function RouteBoxSearch() {
  const { data: boxes } = useAlzaBoxes()
  const { data: routes } = useRoutes()
  const { data: stopsByRoute } = useRouteStops()
  const [q, setQ] = useState('')
  const hits = useMemo(() => (q.trim().length >= 2 ? findBoxInRoutes(boxes ?? [], routes ?? [], stopsByRoute ?? {}, q) : []), [boxes, routes, stopsByRoute, q])
  return (
    <div className="card stack" style={{ gap: 8, padding: 12 }}>
      <div className="card-title" style={{ margin: 0 }}><Icon name="search" />Box keresése a járatokban</div>
      <input className="input" value={q} placeholder="box kódja, neve vagy címe (pl. AB9103, Pomáz)" onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && hits.length === 0 && <div className="tiny muted">Nincs ilyen box a jegyzékben.</div>}
      {hits.map((h) => (
        <div key={h.box.id} className="stack" style={{ gap: 2, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          <div className="small" style={{ fontWeight: 700 }}>{h.box.code ? `${h.box.code} · ` : ''}{h.box.name}</div>
          {h.box.address && <div className="tiny muted">{h.box.address}</div>}
          {h.placements.length === 0
            ? <div className="tiny" style={{ color: 'var(--warning)' }}>Nincs egyik járatban sem.</div>
            : h.placements.map((p) => (
              <div key={p.route} className="small row" style={{ gap: 6 }}>
                <span className="badge primary">{p.route} járat</span>
                <span><strong>{p.index}.</strong> cím a {p.total}-ből{p.eta ? ` · terv: érkezés ${hm(p.eta)}` : ''}{p.deadline ? ` · határidő ${hm(p.deadline)}` : ''}</span>
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}
