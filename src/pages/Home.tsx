import { Link } from 'react-router'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { isCrewRole } from '../lib/labels'
import TodayStepper from '../components/TodayStepper'
import StatusCard from '../components/StatusCard'
import RouteCard from '../components/RouteCard'
import Icon, { type IconName } from '../components/Icon'
import { useCrewConflicts } from '../lib/crewConflicts'
import { usePhotoHelpRequests } from '../lib/photoHelp'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/labels'
import HelpSessionsCard from '../components/HelpSessionsCard'

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
  const { data: todayStatus } = useQuery({
    queryKey: ['status-events', currentWorkspaceId, profile?.id, todayISO(), 'home'],
    enabled: isCrew && !!currentWorkspaceId && !!profile?.id,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase.from('status_events').select('kind, confirmed_at')
        .eq('workspace_id', currentWorkspaceId!).eq('user_id', profile!.id).eq('work_date', todayISO())
      if (error) throw error
      return (data ?? []).map((r) => r.kind as string)
    },
  })
  const enRoute = !!todayStatus?.includes('departed') && !todayStatus.includes('done') && !todayStatus.includes('settled')
  // Vezetőnek: túl sokan egy autón — ezt rendezni kell, a kezdőlapon is kiemeljük
  const { data: conflicts } = useCrewConflicts(isManagerOrAdmin)
  // Vezetőnek: valaki fotó nélkül kér továbbengedést — a kezdőlapon is kiemeljük, ne csak az Áttekintésben
  const { data: photoHelp } = usePhotoHelpRequests(isManagerOrAdmin)
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })

  // Crew: a "Mai nap" lépéssor a főszereplő, ezek csak gyorslinkek — ami az
  // alsó menüben is ott van (beolvasás, autó-hiba, beosztás), azt nem ismételjük
  // Tankolás csak nem elektromos autónál (az autónál állítható a hajtás)
  const electric = today?.car?.fuel_type === 'electric'
  const crewLinks: HubItem[] = [
    { to: '/ellenorzes', icon: 'camera', title: 'Autó-ellenőrzés', desc: '' },
    ...(electric ? [] : [{ to: '/tankolas', icon: 'fuel', title: 'Tankolás', desc: '' } as HubItem]),
    { to: '/takaritas', icon: 'sparkles', title: 'Takarítás', desc: '' },
    { to: '/esemeny', icon: 'alert-triangle', title: 'Esemény / baleset', desc: '' },
    { to: '/boxok', icon: 'package', title: 'AlzaBox kereső', desc: '' },
  ]
  // Box-lap csak az AlzaBox-szállító (Box-kategóriás) autóhoz — az XL-eseknek nincs
  if (today?.car?.category?.box_sheet) crewLinks.unshift({ to: '/box-lap', icon: 'clipboard', title: 'Box-lap', desc: '' })

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
  if (isAdmin) managerHub.push({ to: '/naplo', icon: 'scroll', title: 'Napló', desc: 'Módosítások, app-hibák' })

  return (
    <div className="stack">

      {isCrew && <RouteCard />}
      {isCrew && <StatusCard />}
      {isCrew && !enRoute && <TodayStepper />}

      {isCrew && (
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
        <Link to="/attekintes" className="card stack" style={{ borderColor: 'var(--danger)', borderWidth: 2, textDecoration: 'none', color: 'inherit', gap: 6 }}>
          <div className="card-title" style={{ margin: 0, color: 'var(--danger)' }}>
            <Icon name="bell" />Engedélyt kér fotó nélkül ({photoHelp!.length})
          </div>
          {photoHelp!.map((p) => (
            <div key={p.checkinId} className="small">
              <strong>{p.name}</strong> · <span className="num">{p.plate}</span> <span className="tiny muted">kérte {hhmm(p.helpAt)}</span>
            </div>
          ))}
          <div className="tiny muted row" style={{ gap: 4 }}>Továbbengedés az Áttekintésben <Icon name="chevron-right" size={14} /></div>
        </Link>
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
