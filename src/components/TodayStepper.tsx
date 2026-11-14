import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useToday } from '../hooks/useToday'
import { useInspectionGate } from '../hooks/useInspectionGate'
import Icon, { type IconName } from './Icon'
import ParkCarButton, { useSettledToday } from './ParkCarButton'
import { useTodayStatusEvents } from '../lib/statusEvents'
import { useMyRoutesToday } from '../hooks/useMyRoutesToday'
import { allRoundsDone } from '../lib/rounds'

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
  const { data: settledAt } = useSettledToday()
  // A Box-lap csak a „Kiindultam” jelzés után tölthető — addig a lépés és a gombja inaktív
  const { data: todayEvents } = useTodayStatusEvents()
  const departed = (todayEvents ?? []).some((e) => e.kind === 'departed')
  // Volt már „Járat kész”: innen a Box-lap csak megtekinthető (áttekintés), és az autó lerakása a nap végi kártyán jön
  const anyDone = (todayEvents ?? []).some((e) => e.kind === 'done')
  // Minden mai kör kész: a Box-lap már nem lépés, csak visszanézhető / javítható (a módosítás naplózódik)
  const { data: myRoutes } = useMyRoutesToday()
  const roundsOver = !!todayEvents && allRoundsDone(myRoutes?.length ?? 0, todayEvents)
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
        .select('id', { count: 'exact', head: true }).eq('car_id', car!.id).eq('work_date', date).not('completed_at', 'is', null)
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
  const electric = car?.fuel_type === 'electric'
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
      key: 'boxsheet', icon: 'package' as IconName, title: anyDone ? 'Box-lapok' : 'Box-lap', to: '/box-lap', cta: 'Box-lap kitöltése',
      detail: boxSheet?.submitted ? `Lezárva ${hhmm(boxSheet.submittedAt!)} · ${boxSheet.stops} box` : anyDone || roundsOver ? `${boxSheet?.stops ?? 0} box rögzítve` : boxSheet?.stops ? `${boxSheet.stops} box rögzítve` : departed ? 'Boxonként: behelyezett, hiány, visszáru…' : 'A „Kiindultam” jelzés után tölthető',
      state: (boxSheet?.submitted || roundsOver || anyDone ? 'done' : 'todo') as StepState,
    }] : []),
    {
      // Nap vége = elszámolás után az autó lerakva (elektromosnál töltőre téve) — nincs külön kijelentkezés
      key: 'parked', icon: electric ? 'zap' : 'flag', title: electric ? 'Autó lerakva, töltőn' : 'Autó lerakva', to: '/', cta: electric ? 'Autó lerakva, töltőre téve' : 'Autó lerakva',
      detail: checkedOut ? `Nap lezárva ${hhmm(checkin!.checked_out_at!)}` : settledAt ? `Elszámoltál ${hhmm(settledAt)} — ${electric ? 'töltőre, és koppints' : 'rakd le, és koppints'}` : 'Az „Elszámoltam” jelzés után, az autó leadásakor',
      state: checkedOut ? 'done' : 'todo',
    },
  ]

  // A következő lépés: az első, ami nincs kész és nem "kihagyható"
  // (kötelező ellenőrzés mindent megelőz)
  // „Járat kész” után (amíg a nap nincs lezárva): nincs kitöltendő lépés ezen a kártyán — csak a Box-lapok megtekintése
  const review = anyDone && !checkedOut
  let next: Step | null = null
  if (!checkin) next = steps[0]
  else if (!inspected && !gate.waived) next = steps[1]
  else if (review) next = null
  else if (needsBoxSheet && !boxSheet?.submitted && !roundsOver) next = steps.find((s) => s.key === 'boxsheet') ?? null
  else if (!checkedOut) next = steps[steps.length - 1]
  for (const s of steps) if (s === next) s.state = 'next'
  const allDone = !next && !review
  // járat kész után az „Autó lerakva” sor nem látszik — a nap végén a saját kártyáján jön
  const visible = steps.filter((s) => !((s.key === 'checkin' || s.key === 'inspection') && s.state === 'done') && !(review && s.key === 'parked'))
  if (review && visible.length === 0) return null

  return (
    <div className={`card stack${allDone || review ? '' : ' primary'}`} style={{ borderColor: allDone ? 'var(--success)' : undefined }}>
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}><Icon name="clipboard" />Mai nap</div>
        {/* A kész becsekkolás és ellenőrzés nem sor: kis ikonként a felső sávban (AppShell) látszik */}
        <span className="row" style={{ gap: 10, alignItems: 'center' }}>
          {allDone && <span className="badge success"><Icon name="check" />Kész</span>}
        </span>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {visible.map((s) => {
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
      {next && next.key === 'parked' ? (
        <ParkCarButton />
      ) : next && next.key === 'boxsheet' && !departed ? (
        // kiindulás előtt a Box-lap gombja inaktív — a lap a járat közben, a járat-kártyáról tölthető
        <button type="button" className="btn" disabled title="A Box-lap a „Kiindultam” jelzés után tölthető">
          <Icon name="lock" />Box-lap — a „Kiindultam” után
        </button>
      ) : next && (
        <Link to={next.to} className="btn" style={{ textDecoration: 'none' }}>
          <Icon name={next.icon} />{next.cta}
        </Link>
      )}
      {/* járat kész után és a lezárt napon: a mai Box-lapok áttekintése (összecsukva, kinyitva javítható) */}
      {needsBoxSheet && (review || checkedOut) && (
        <Link to="/box-lap" className="btn secondary" style={{ textDecoration: 'none' }}>
          <Icon name="package" />Box-lapok megtekintése
        </Link>
      )}
      {allDone && <div className="tiny muted">Szép munka! A holnapi beosztásod a Beosztás fülön.</div>}
    </div>
  )
}
