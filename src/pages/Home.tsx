import { Link } from 'react-router'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { isCrewRole } from '../lib/labels'
import TodayStepper from '../components/TodayStepper'
import StatusCard from '../components/StatusCard'
import SetOffCard from '../components/SetOffCard'
import { useTodayStatusEvents } from '../lib/statusEvents'
import RouteCard from '../components/RouteCard'
import Icon, { type IconName } from '../components/Icon'
import { useCrewConflicts } from '../lib/crewConflicts'
import { usePhotoHelpRequests, useWaiveInspection } from '../lib/photoHelp'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import ConfirmButton from '../components/ConfirmButton'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import HelpSessionsCard from '../components/HelpSessionsCard'
import WaiverRequest from '../components/WaiverRequest'

interface HubItem { to: string; icon: IconName; title: string; desc: string; group?: string; badge?: number }

export default function Home() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const role = profile?.role
  const isCrew = isCrewRole(role)
  const isManagerOrAdmin = role === 'manager' || role === 'admin'
  const isAdmin = role === 'admin'
  const { data: today } = useToday()
  // Úton vagyok: a „Kiindultam” jelzés után (amíg nincs „Járat kész” / „Elszámoltam”)
  // a kezdőlap csak a járatot, a jelzéseket és a gyorslinkeket mutatja — a napi lépéssor és a fejléc részletei eltűnnek
  const { data: todayStatus } = useTodayStatusEvents()
  // „Elindultam” — a nap első jelzése, becsekkolás előtt; amíg nincs meg, a kezdőlapon csak ez a gomb van
  const setOffAt = todayStatus?.find((s) => s.kind === 'set_off')?.at ?? null
  // Zár: van mai becsekkolás, de nincs kész ellenőrzés és nincs vezetői engedély
  const inspectionLocked = isCrew && !!today?.checkin && !today.inspectionDone && !today.checkin.inspection_waived_at

  // Vezetőnek: túl sokan egy autón — ezt rendezni kell, a kezdőlapon is kiemeljük
  const { data: conflicts } = useCrewConflicts(isManagerOrAdmin)
  // Vezetőnek: valaki fotó nélkül kér továbbengedést — a kezdőlapon is kiemeljük, ne csak az Áttekintésben
  const { data: photoHelp } = usePhotoHelpRequests(isManagerOrAdmin)
  const waive = useWaiveInspection()
  // Realtime: engedélykérés, fotózás, autó-hiba, segítségkérés, jóváhagyás — a vezető kezdőlapja azonnal frissüljön, ne 30–60 mp késéssel
  useRealtimeInvalidate(isManagerOrAdmin ? currentWorkspaceId : null, ['check_ins', 'car_inspections', 'car_issues', 'help_sessions', 'profiles'], [['photo-help'], ['crew-conflicts'], ['home-counts']])
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })

  // Crew: a "Mai nap" lépéssor a főszereplő, ezek csak gyorslinkek — ami az
  // alsó menüben is ott van (beolvasás, autó-hiba, beosztás), azt nem ismételjük
  // Tankolás csak nem elektromos autónál (az autónál állítható a hajtás)
  const electric = today?.car?.fuel_type === 'electric'
  // Autó-ellenőrzés gyorslink nincs: a fotósor a becsekkolás / autócsere után automatikusan jön
  const crewLinks: HubItem[] = [
    ...(electric ? [] : [{ to: '/tankolas', icon: 'fuel', title: 'Tankolás', desc: '' } as HubItem]),
    { to: '/takaritas', icon: 'sparkles', title: 'Takarítás', desc: '' },
    { to: '/esemeny', icon: 'alert-triangle', title: 'Esemény / baleset', desc: '' },
    { to: '/boxok', icon: 'package', title: 'AlzaBox kereső', desc: '' },
  ]

  // Számok a csempéken: mire kell ránézni (jóváhagyásra váró, nyitott autó-hiba, segítségkérés)
  const { data: counts } = useQuery({
    queryKey: ['home-counts', currentWorkspaceId],
    enabled: isManagerOrAdmin && !!currentWorkspaceId,
    refetchInterval: 60000,
    queryFn: async () => {
      const [p, i, h] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('car_issues').select('id', { count: 'exact', head: true }).eq('workspace_id', currentWorkspaceId!).neq('status', 'resolved'),
        supabase.from('help_sessions').select('id', { count: 'exact', head: true }).eq('workspace_id', currentWorkspaceId!).is('ended_at', null).gt('last_seen_at', new Date(Date.now() - 90_000).toISOString()),
      ])
      return { pending: p.count ?? 0, issues: i.count ?? 0, help: h.count ?? 0 }
    },
  })
  const managerHub: HubItem[] = [
    { group: 'Napi munka', to: '/attekintes', icon: 'layout-dashboard', title: 'Áttekintés', desc: 'Ki hol tart ma' },
    { group: 'Napi munka', to: '/beosztas-szerkeszto', icon: 'calendar', title: 'Beosztás', desc: 'Heti táblázat, párosok' },
    { group: 'Napi munka', to: '/jaratok', icon: 'map', title: 'Járatok', desc: 'Boxok sorrendje, terv' },
    { group: 'Napi munka', to: '/terkep', icon: 'map-pin', title: 'Térkép', desc: 'Autók élőben' },
    { group: 'Napi munka', to: '/elo-nezet', icon: 'life-buoy', title: 'Élő nézet', desc: 'Segítség, ha elakad', badge: counts?.help },
    { group: 'Emberek és autók', to: '/jovahagyas', icon: 'user-check', title: 'Jóváhagyás', desc: 'Új regisztrációk', badge: counts?.pending },
    { group: 'Emberek és autók', to: '/tagok', icon: 'users', title: 'Tagok', desc: 'Szerepek, meghívók' },
    { group: 'Emberek és autók', to: '/autok', icon: 'truck', title: 'Autók', desc: 'QR-kódok, kategóriák' },
    { group: 'Emberek és autók', to: '/hibak', icon: 'wrench', title: 'Autó-hibák', desc: 'Bejelentések', badge: counts?.issues },
    { group: 'Pénz és kimutatás', to: '/riportok', icon: 'trending-up', title: 'Riportok', desc: 'Napok, órák, üzemanyag' },
    { group: 'Pénz és kimutatás', to: '/elolegek', icon: 'wallet', title: 'Előleg / levonás', desc: 'Rögzítés' },
    { group: 'Pénz és kimutatás', to: '/bizonyitek', icon: 'camera', title: 'Bizonyíték-fotók', desc: 'Kosz, törés' },
    { group: 'Előzmények', to: '/box-lapok', icon: 'package', title: 'Box-lapok', desc: 'Napi szállítási lapok' },
    { group: 'Előzmények', to: '/tortenet', icon: 'history', title: 'Előzmények', desc: 'Autók, cserék, események' },
    { group: 'Előzmények', to: '/kepek', icon: 'image', title: 'Képek', desc: 'Autó, nap, ember szerint' },
    { group: 'Előzmények', to: '/boxok', icon: 'map-pin', title: 'AlzaBoxok', desc: 'Hol van a box?' },
  ]
  if (isAdmin) {
    managerHub.push({ group: 'Pénz és kimutatás', to: '/ber', icon: 'calculator', title: 'Bér / kimutatás', desc: 'Bér, Excel export' })
    managerHub.push({ group: 'Pénz és kimutatás', to: '/statisztika', icon: 'target', title: 'Statisztika', desc: 'Átlagok, rangsorok' })
    managerHub.push({ group: 'Előzmények', to: '/naplo', icon: 'scroll', title: 'Napló', desc: 'Ki mit módosított' })
  }
  const hubGroups = ['Napi munka', 'Emberek és autók', 'Pénz és kimutatás', 'Előzmények']

  return (
    <div className="stack">

      {/* Becsekkolás előtt: először az „Elindultam” (csak ez látszik, a mai autóval) — utána a Mai nap lépéssor a QR-gombbal */}
      {isCrew && today && !today.checkin && todayStatus && <SetOffCard setOffAt={setOffAt} />}
      {isCrew && !today?.checkin && !!setOffAt && <TodayStepper />}
      {/* Becsekkolás után, amíg az ellenőrzés (5 fotó vagy vezetői engedély) nincs meg: csak ez a kártya —
          a többi funkció zárva, elérhető: Beosztás, Autó-hiba */}
      {isCrew && inspectionLocked && today?.checkin && (
        <div className="card stack" style={{ borderColor: 'var(--warning)', gap: 8 }}>
          <div className="card-title" style={{ margin: 0 }}><Icon name="camera" />Autó-ellenőrzés — {today.car?.plate}</div>
          <Link to="/ellenorzes" className="btn" style={{ textDecoration: 'none' }}><Icon name="camera" />Fotók készítése (5 kép)</Link>
          <WaiverRequest checkinId={today.checkin.id} requestedAt={today.checkin.inspection_help_requested_at} />
          <div className="tiny muted">Amíg ez nincs meg, csak a Beosztás és az Autó-hiba érhető el.</div>
        </div>
      )}
      {isCrew && !inspectionLocked && !!today?.checkin && <RouteCard />}
      {isCrew && !inspectionLocked && !!today?.checkin && <StatusCard />}
      {/* A lépéssor (benne a Box-lap) úton is látszik — a boxokhoz a kiindulás után érnek */}
      {isCrew && !inspectionLocked && !!today?.checkin && <TodayStepper />}

      {isCrew && !inspectionLocked && !!today?.checkin && (
        <div>
          <div className="card-title" style={{ marginBottom: 8 }}>Gyorslinkek</div>
          <div className="chips">
            {crewLinks.map((i) => (
              <Link key={i.to} to={i.to} className="chip"><Icon name={i.icon} />{i.title}</Link>
            ))}
          </div>
        </div>
      )}

      {isManagerOrAdmin && <HelpSessionsCard />}
      {isManagerOrAdmin && (photoHelp?.length ?? 0) > 0 && (
        <div className="card stack" style={{ borderColor: 'var(--danger)', borderWidth: 2, gap: 8 }}>
          <div className="card-title" style={{ margin: 0, color: 'var(--danger)' }}>
            <Icon name="bell" />Engedélyt kér fotó nélkül ({photoHelp!.length})
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>Amíg nincs körbefotózva az autó, a munkatárs napja áll. Ha indokolt, itt engedheted tovább — a neved a becsekkolásra és a naplóba kerül.</p>
          {photoHelp!.map((p) => (
            <div key={p.checkinId} className="between" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <span className="small" style={{ minWidth: 0 }}>
                <strong>{p.name}</strong> · <span className="num">{p.plate}</span> <span className="tiny muted">kérte {hhmm(p.helpAt)}</span>
              </span>
              <ConfirmButton className="btn sm auto" confirmLabel="Biztos? Továbbengedem" disabled={waive.isPending} onConfirm={() => waive.mutate(p.checkinId)}>
                <Icon name="shield-check" size={14} />Továbbengedés
              </ConfirmButton>
            </div>
          ))}
          <Link to="/attekintes" className="tiny muted row" style={{ gap: 4, textDecoration: 'none' }}>Részletek az Áttekintésben <Icon name="chevron-right" size={14} /></Link>
        </div>
      )}

      {isManagerOrAdmin && (conflicts?.length ?? 0) > 0 && (
        <Link to="/attekintes" className="card stack" style={{ borderColor: 'var(--danger)', borderWidth: 2, textDecoration: 'none', color: 'inherit', gap: 6 }}>
          <div className="card-title" style={{ margin: 0, color: 'var(--danger)' }}>
            <Icon name="users" />Megoldandó: túl sokan egy autón
          </div>
          {conflicts!.map((c) => (
            <div key={c.carId} className="small">
              <span className="num">{c.plate}</span> · {c.people.map((p) => p.name).join(', ')} <span className="tiny muted">({c.people.length} fő, {c.capacity} fős autó)</span>
            </div>
          ))}
          <div className="tiny muted row" style={{ gap: 4 }}>Rendezés az Áttekintésben <Icon name="chevron-right" size={14} /></div>
        </Link>
      )}

      {isManagerOrAdmin && hubGroups.map((g) => (
        <div key={g} className="hub-group">
          <div className="card-title">{g}</div>
          <div className="hub">
            {managerHub.filter((i) => i.group === g).map((i) => (
              <Link key={i.to} to={i.to}>
                <Icon name={i.icon} />
                <div style={{ minWidth: 0 }}>
                  <div className="name">{i.title}</div>
                  <div className="tiny muted">{i.desc}</div>
                </div>
                {!!i.badge && <span className="badge warning hub-badge">{i.badge}</span>}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
