import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { formatDateTime, dailyRoleLabel, isCrewRole } from '../lib/labels'
import TodayStepper from '../components/TodayStepper'
import Icon, { type IconName } from '../components/Icon'
import { useCrewConflicts } from '../lib/crewConflicts'

interface HubItem { to: string; icon: IconName; title: string; desc: string }

export default function Home() {
  const { profile } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const role = profile?.role
  const isCrew = isCrewRole(role)
  const isManagerOrAdmin = role === 'manager' || role === 'admin'
  const isAdmin = role === 'admin'
  const { data: today } = useToday()
  // Vezetőnek: túl sokan egy autón — ezt rendezni kell, a kezdőlapon is kiemeljük
  const { data: conflicts } = useCrewConflicts(isManagerOrAdmin)

  // Crew: a "Mai nap" lépéssor a főszereplő, ezek csak gyorslinkek — ami az
  // alsó menüben is ott van (beolvasás, fuvar, beosztás), azt nem ismételjük
  const crewLinks: HubItem[] = [
    { to: '/ellenorzes', icon: 'camera', title: 'Autó-ellenőrzés', desc: '' },
    { to: '/tankolas', icon: 'fuel', title: 'Tankolás', desc: '' },
    { to: '/esemeny', icon: 'alert-triangle', title: 'Esemény / baleset', desc: '' },
    { to: '/hibak', icon: 'wrench', title: 'Autó-hiba', desc: '' },
  ]

  const managerHub: HubItem[] = [
    { to: '/attekintes', icon: 'layout-dashboard', title: 'Áttekintés', desc: 'Élő napi műszerfal' },
    { to: '/beosztas-szerkeszto', icon: 'calendar', title: 'Beosztás', desc: 'Napi párosok, heti nézet' },
    { to: '/jovahagyas', icon: 'user-check', title: 'Jóváhagyás', desc: 'Új regisztrációk' },
    { to: '/tagok', icon: 'users', title: 'Tagok', desc: 'Szerepek, tiltás' },
    { to: '/autok', icon: 'truck', title: 'Autók', desc: 'QR-kódok kezelése' },
    { to: '/fuvar-feltoltes', icon: 'upload', title: 'Fuvarterv feltöltés', desc: 'Excel autóhoz/naphoz' },
    { to: '/riportok', icon: 'trending-up', title: 'Riportok', desc: 'Napok, órák, üzemanyag' },
    { to: '/terkep', icon: 'map-pin', title: 'Térkép', desc: 'Autók és stopok élőben' },
    { to: '/hibak', icon: 'wrench', title: 'Autó-hibák', desc: 'Bejelentések követése' },
    { to: '/elolegek', icon: 'wallet', title: 'Előleg / levonás', desc: 'Rögzítés' },
    { to: '/bizonyitek', icon: 'camera', title: 'Bizonyíték-fotók', desc: 'Kosz / törés → levonás' },
    { to: '/kepek', icon: 'image', title: 'Képek', desc: 'Autó, nap, ember szerint' },
    { to: '/tortenet', icon: 'history', title: 'Előzmények', desc: 'Autók, cserék, események' },
  ]
  if (isAdmin) managerHub.push({ to: '/ber', icon: 'calculator', title: 'Bér / kimutatás', desc: 'Bér, Excel export' })
  if (isAdmin) managerHub.push({ to: '/statisztika', icon: 'target', title: 'Statisztika', desc: 'Átlagok, rangsorok' })
  if (isAdmin) managerHub.push({ to: '/naplo', icon: 'scroll', title: 'Napló', desc: 'Módosítások, app-hibák' })

  return (
    <div className="stack">
      <div className="card">
        <Link to="/profil" className="between" style={{ textDecoration: 'none', color: 'inherit' }} aria-label="Profil megnyitása">
          <div style={{ minWidth: 0 }}>
            <div className="muted small">Üdv,</div>
            <h2 style={{ fontSize: 22, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.full_name ?? profile?.email}</h2>
            <div className="tiny muted">Profil, értesítések, kilépés</div>
          </div>
          <Icon name="chevron-right" className="muted" />
        </Link>
        <div className="divider" style={{ margin: '14px 0' }} />
        <div className="between">
          <span className="muted small">Munkaterület</span>
          <span className="badge">{currentWorkspace?.name ?? '–'}</span>
        </div>
        {isCrew && (
          <div className="between" style={{ marginTop: 10 }}>
            <span className="muted small">Mai szerep</span>
            {today?.assignedRole
              ? <span className="badge primary">{dailyRoleLabel[today.assignedRole]}</span>
              : <span className="badge">Nincs mai beosztás</span>}
          </div>
        )}
        {isCrew && (
          <div className="between" style={{ marginTop: 10 }}>
            <span className="muted small">Mai autó</span>
            {today?.car
              ? <span className="badge success num">{today.car.plate}</span>
              : <span className="badge">Nincs becsekkolva</span>}
          </div>
        )}
        {isCrew && today?.checkin && (
          <div className="tiny muted" style={{ marginTop: 6 }}>Becsekkolva: {formatDateTime(today.checkin.checked_in_at)}</div>
        )}
      </div>

      {isCrew && <TodayStepper />}

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

      {isManagerOrAdmin && (
        <div>
          <div className="card-title" style={{ marginBottom: 8 }}>Vezetői eszközök</div>
          <div className="hub">
            {managerHub.map((i) => (
              <Link key={i.to} to={i.to}>
                <Icon name={i.icon} />
                <div style={{ minWidth: 0 }}>
                  <div className="name">{i.title}</div>
                  <div className="tiny muted">{i.desc}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
