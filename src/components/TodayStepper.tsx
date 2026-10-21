import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useToday } from '../hooks/useToday'
import { useInspectionGate } from '../hooks/useInspectionGate'
import Icon, { type IconName } from './Icon'

// "Mai nap" lépéssor a munkatárs kezdőlapján: hol tart a nap, és egy gombbal
// a KÖVETKEZŐ lépésre visz. A sofőr napja lineáris (becsekk → ellenőrzés →
// kijelentkezés) — ezt mutatjuk a hét egyforma csempe helyett. (A fuvartervet
// külön alkalmazás kezeli, itt csak az autóval kapcsolatos lépések vannak.)
type StepState = 'done' | 'next' | 'todo' | 'skip' | 'blocked'
interface Step { key: string; icon: IconName; title: string; detail: string; state: StepState; to: string; cta: string }

const STATE_ICON: Record<StepState, { name: IconName; color: string }> = {
  done: { name: 'check-circle', color: 'var(--success)' },
  next: { name: 'circle-dot', color: 'var(--primary)' },
  blocked: { name: 'ban', color: 'var(--warning)' },
  skip: { name: 'circle', color: 'var(--text-dim)' },
  todo: { name: 'circle', color: 'var(--text-dim)' },
}

export default function TodayStepper() {
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

  // Box-lap (csak AlzaBox-szállító autónál): a mai lap állapota
  const needsBoxSheet = !!car?.category?.box_sheet
  const { data: boxSheet } = useQuery({
    queryKey: ['box-sheet-status', car?.id, date],
    enabled: needsBoxSheet,
    queryFn: async () => {
      const { data, error } = await supabase.from('box_sheets')
        .select('status, submitted_at, stops:box_sheet_stops(count)').eq('work_date', date).eq('car_id', car!.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      const row = data as unknown as { status: string; submitted_at: string | null; stops: { count: number }[] } | null
      return row ? { submitted: row.status === 'submitted', submittedAt: row.submitted_at, stops: row.stops?.[0]?.count ?? 0 } : null
    },
  })

  if (isLoading) return null

  const checkedOut = !!checkin?.checked_out_at
  const inspected = (inspCount ?? 0) > 0
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })

  const steps: Step[] = [
    {
      key: 'checkin', icon: 'qr-code', title: 'Becsekkolás', to: '/beolvasas', cta: 'QR beolvasása',
      detail: checkin ? `${car?.plate ?? ''} · ${hhmm(checkin.checked_in_at)}` : 'Olvasd be az autó QR-kódját',
      state: checkin ? 'done' : 'next',
    },
    {
      key: 'inspection', icon: 'camera', title: 'Autó-ellenőrzés', to: '/ellenorzes', cta: 'Ellenőrzés indítása',
      detail: inspected ? 'Fotók elmentve' : gate.waived ? `Vezetői engedéllyel fotó nélkül (${hhmm(gate.waivedAt!)})` : checkin ? 'Kötelező — enélkül a nap nem mehet tovább' : '5 fotó körbe az autón, a végén a fülke',
      state: inspected || gate.waived ? 'done' : !checkin ? 'todo' : 'blocked',
    },
    ...(needsBoxSheet ? [{
      key: 'boxsheet', icon: 'package' as IconName, title: 'Box-lap', to: '/box-lap', cta: 'Box-lap kitöltése',
      detail: boxSheet?.submitted ? `Lezárva ${hhmm(boxSheet.submittedAt!)} · ${boxSheet.stops} box` : boxSheet?.stops ? `${boxSheet.stops} box rögzítve — a nap végén zárd le` : 'Boxonként: behelyezett, hiány, visszáru…',
      state: (boxSheet?.submitted ? 'done' : checkin ? 'todo' : 'todo') as StepState,
    }] : []),
    {
      key: 'checkout', icon: 'flag', title: 'Kijelentkezés', to: '/beolvasas', cta: 'Kijelentkezés (nap vége)',
      detail: checkedOut ? `Nap lezárva ${hhmm(checkin!.checked_out_at!)}` : 'A nap végén, az autó leadásakor',
      state: checkedOut ? 'done' : 'todo',
    },
  ]

  // A következő lépés: az első, ami nincs kész és nem "kihagyható"
  // (kötelező ellenőrzés mindent megelőz)
  let next: Step | null = null
  if (!checkin) next = steps[0]
  else if (!inspected && !gate.waived) next = steps[1]
  else if (needsBoxSheet && !boxSheet?.submitted) next = steps.find((s) => s.key === 'boxsheet') ?? null
  else if (!checkedOut) next = steps[steps.length - 1]
  for (const s of steps) if (s === next) s.state = 'next'
  const allDone = !next

  return (
    <div className={`card stack${allDone ? '' : ' primary'}`} style={{ borderColor: allDone ? 'var(--success)' : undefined }}>
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}><Icon name="clipboard" />Mai nap</div>
        {allDone && <span className="badge success"><Icon name="check" />Kész</span>}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {steps.map((s) => {
          const st = STATE_ICON[s.state]
          return (
            <div key={s.key} className="row" style={{ gap: 12, alignItems: 'flex-start', opacity: s.state === 'todo' ? 0.65 : 1 }}>
              <Icon name={st.name} size={22} style={{ color: st.color, marginTop: 1 }} />
              <div style={{ minWidth: 0 }}>
                <div className="small" style={{ fontWeight: s.state === 'next' || s.state === 'blocked' ? 800 : 600 }}>{s.title}</div>
                <div className="tiny muted" style={{ color: s.state === 'blocked' ? 'var(--warning)' : undefined }}>{s.detail}</div>
              </div>
            </div>
          )
        })}
      </div>
      {next && (
        <Link to={next.to} className="btn" style={{ textDecoration: 'none' }}>
          <Icon name={next.icon} />{next.cta}
        </Link>
      )}
      {allDone && <div className="tiny muted">Szép munka! A holnapi beosztásod a Beosztás fülön.</div>}
    </div>
  )
}
