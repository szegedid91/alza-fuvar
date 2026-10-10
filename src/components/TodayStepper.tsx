import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { useInspectionGate } from '../hooks/useInspectionGate'
import { routeUploadQuery, routeStopsQuery } from '../lib/routeQueries'
import { formatHuf } from '../lib/labels'

// "Mai nap" lépéssor a munkatárs kezdőlapján: hol tart a nap, és egy gombbal
// a KÖVETKEZŐ lépésre visz. A sofőr napja lineáris (becsekk → ellenőrzés →
// fuvar → kijelentkezés) — ezt mutatjuk a hét egyforma csempe helyett.
type StepState = 'done' | 'next' | 'todo' | 'skip' | 'blocked'
interface Step { key: string; icon: string; title: string; detail: string; state: StepState; to: string; cta: string }

export default function TodayStepper() {
  const { currentWorkspaceId } = useWorkspace()
  const { data: today, isLoading } = useToday()
  const car = today?.car ?? null
  const date = today?.date ?? ''
  const checkin = today?.checkin ?? null

  // Kötelező-e ma az ellenőrzés (9-e / sofőrváltás) — csak becsekkolás után értelmes
  const gate = useInspectionGate(car?.id, date)
  const { data: inspCount } = useQuery({
    queryKey: ['inspections-today', car?.id, date],
    enabled: !!car,
    queryFn: async () => {
      const { count, error } = await supabase.from('car_inspections')
        .select('id', { count: 'exact', head: true }).eq('car_id', car!.id).eq('work_date', date)
      if (error) throw error
      return count ?? 0
    },
  })
  // A fuvarterv ugyanabból a cache-ből, amit a becsekkolás előtöltött
  const { data: upload } = useQuery({
    ...routeUploadQuery(currentWorkspaceId ?? '', car?.id ?? '', date),
    enabled: !!currentWorkspaceId && !!car,
  })
  const { data: stops } = useQuery({ ...routeStopsQuery(upload?.id ?? ''), enabled: !!upload })

  if (isLoading) return null

  const checkedOut = !!checkin?.checked_out_at
  const inspected = (inspCount ?? 0) > 0
  const total = stops?.length ?? 0
  const done = (stops ?? []).filter((s) => s.status !== 'pending').length
  const cash = (stops ?? []).filter((s) => s.is_cash && s.status !== 'skipped').reduce((a, s) => a + Number(s.expected_amount ?? 0), 0)

  const steps: Step[] = []
  steps.push({
    key: 'checkin', icon: '📷', title: 'Becsekkolás', to: '/beolvasas', cta: 'QR beolvasása',
    detail: checkin ? `${car?.plate ?? ''} · ${new Date(checkin.checked_in_at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}` : 'Olvasd be az autó QR-kódját',
    state: checkin ? 'done' : 'next',
  })
  steps.push({
    key: 'inspection', icon: '🚗', title: 'Autó-ellenőrzés', to: '/ellenorzes', cta: 'Ellenőrzés indítása',
    detail: inspected ? 'Fotók elmentve' : gate.blocked ? 'Ma KÖTELEZŐ — a fuvar addig zárva' : checkin ? 'Ma nem kötelező (bármikor készíthetsz)' : '5 fotó: elöl, hátul, bal, jobb, beltér',
    state: inspected ? 'done' : !checkin ? 'todo' : gate.blocked ? 'blocked' : 'skip',
  })
  steps.push({
    key: 'route', icon: '🗺️', title: 'Fuvarterv', to: '/fuvar', cta: upload ? 'Fuvarterv megnyitása' : 'Fuvarterv importálása',
    detail: !checkin ? 'Stopok, navigáció, pénz' : !upload ? 'Még nincs mai fuvarterv' : `${done}/${total} stop kész${cash > 0 ? ` · leadandó ${formatHuf(cash)}` : ''}`,
    state: !checkin ? 'todo' : upload && total > 0 && done === total ? 'done' : 'todo',
  })
  steps.push({
    key: 'checkout', icon: '🏁', title: 'Kijelentkezés', to: '/beolvasas', cta: 'Kijelentkezés (nap vége)',
    detail: checkedOut ? `Nap lezárva ${new Date(checkin!.checked_out_at!).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}` : 'A nap végén, az autó leadásakor',
    state: checkedOut ? 'done' : 'todo',
  })

  // A következő lépés: az első, ami nincs kész és nem "kihagyható"
  // (kötelező ellenőrzés mindent megelőz)
  let next: Step | null = null
  if (!checkin) next = steps[0]
  else if (gate.blocked && !inspected) next = steps[1]
  else if (!(upload && total > 0 && done === total) && !checkedOut) next = steps[2]
  else if (!checkedOut) next = steps[3]
  for (const s of steps) if (s === next) s.state = 'next'

  const allDone = !next
  const icon = (s: Step) => s.state === 'done' ? '✅' : s.state === 'blocked' ? '⛔' : s.state === 'next' ? '👉' : s.state === 'skip' ? '◽' : '⬜'

  return (
    <div className="card stack" style={{ borderColor: allDone ? 'var(--success)' : 'var(--primary)' }}>
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}>📋 Mai nap</div>
        {allDone && <span className="badge success">Kész ✔</span>}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {steps.map((s) => (
          <div key={s.key} className="row" style={{ gap: 10, alignItems: 'flex-start', opacity: s.state === 'todo' ? 0.7 : 1 }}>
            <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>{icon(s)}</span>
            <div style={{ minWidth: 0 }}>
              <div className="small" style={{ fontWeight: s.state === 'next' || s.state === 'blocked' ? 800 : 600 }}>{s.icon} {s.title}</div>
              <div className="tiny muted" style={{ color: s.state === 'blocked' ? 'var(--warning)' : undefined }}>{s.detail}</div>
            </div>
          </div>
        ))}
      </div>
      {next && (
        <Link to={next.to} className="btn" style={{ textDecoration: 'none' }}>
          {next.icon} {next.cta}
        </Link>
      )}
      {allDone && <div className="tiny muted">Szép munka! Holnapi beosztásod a 📅 Beosztás fülön.</div>}
    </div>
  )
}
