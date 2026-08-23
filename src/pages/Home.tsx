import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { roleLabel, formatDateTime, dailyRoleLabel, isCrewRole } from '../lib/labels'

interface HubItem { to: string; icon: string; title: string; desc: string }

export default function Home() {
  const { profile } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const role = profile?.role
  const isCrew = isCrewRole(role)
  const isManagerOrAdmin = role === 'manager' || role === 'admin'
  const isAdmin = role === 'admin'
  const { data: today } = useToday()

  const crewHub: HubItem[] = [
    { to: '/beolvasas', icon: '📷', title: 'Becsekkolás', desc: 'QR beolvasás, nap indítása' },
    { to: '/ellenorzes', icon: '🚗', title: 'Autó-ellenőrzés', desc: 'Fotók, takarítás' },
    { to: '/tankolas', icon: '⛽', title: 'Tankolás', desc: 'Blokk + km + fogyasztás' },
    { to: '/esemeny', icon: '⚠️', title: 'Esemény / baleset', desc: 'Azonnali fotó-dokumentáció' },
    { to: '/fuvar', icon: '🗺️', title: 'Fuvarterv', desc: 'Stop-lista, navigáció, pénz' },
    { to: '/beosztas', icon: '📅', title: 'Beosztásom', desc: 'Dátum, autó, társ, csere' },
    { to: '/hibak', icon: '🔧', title: 'Autó-hiba', desc: 'Probléma bejelentése' },
  ]

  const managerHub: HubItem[] = [
    { to: '/attekintes', icon: '📊', title: 'Áttekintés', desc: 'Élő napi műszerfal' },
    { to: '/riportok', icon: '📈', title: 'Riportok', desc: 'Napok, órák, üzemanyag' },
    { to: '/terkep', icon: '🗺️', title: 'Térkép', desc: 'Autók és stopok élőben' },
    { to: '/hibak', icon: '🔧', title: 'Autó-hibák', desc: 'Bejelentések követése' },
    { to: '/jovahagyas', icon: '✅', title: 'Jóváhagyás', desc: 'Új regisztrációk' },
    { to: '/tagok', icon: '👥', title: 'Tagok', desc: 'Szerepek, tiltás' },
    { to: '/autok', icon: '🚗', title: 'Autók', desc: 'QR-kódok kezelése' },
    { to: '/beosztas-szerkeszto', icon: '📅', title: 'Beosztás', desc: 'Napi párosok, heti nézet' },
    { to: '/fuvar-feltoltes', icon: '📤', title: 'Fuvarterv feltöltés', desc: 'Excel autóhoz/naphoz' },
    { to: '/elolegek', icon: '💰', title: 'Előleg / levonás', desc: 'Rögzítés' },
    { to: '/bizonyitek', icon: '📸', title: 'Bizonyíték-fotók', desc: 'Kosz / törés → levonás' },
  ]
  managerHub.push({ to: '/kepek', icon: '🖼️', title: 'Képek', desc: 'Fotók: autó, nap, ember szerint' })
  managerHub.push({ to: '/tortenet', icon: '🕓', title: 'Előzmények', desc: 'Autók, cserék, események visszamenőleg' })
  if (isAdmin) managerHub.push({ to: '/ber', icon: '🧮', title: 'Bér / kimutatás', desc: 'Bér, Excel export' })
  if (isAdmin) managerHub.push({ to: '/naplo', icon: '📜', title: 'Napló', desc: 'Módosítások nyomon követése' })

  return (
    <div className="stack">
      <div className="card">
        <div className="between">
          <div>
            <div className="muted small">Üdv,</div>
            <h2>{profile?.full_name ?? profile?.email}</h2>
          </div>
          <span className="badge primary">{role ? roleLabel[role] : ''}</span>
        </div>
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
              ? <span className="badge success">{today.car.plate}</span>
              : <span className="badge warning">Nincs becsekkolva</span>}
          </div>
        )}
        {isCrew && today?.checkin && (
          <div className="tiny muted" style={{ marginTop: 6 }}>Becsekkolva: {formatDateTime(today.checkin.checked_in_at)}</div>
        )}
      </div>

      {isCrew && <HubGrid title="Napi munkafolyamat" items={crewHub} />}
      {isManagerOrAdmin && <HubGrid title="Vezetői eszközök" items={managerHub} />}
    </div>
  )
}

function HubGrid({ title, items }: { title: string; items: HubItem[] }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="grid-2">
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="list-item" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ fontSize: 26 }}>{i.icon}</div>
            <div className="name" style={{ fontSize: 15, marginTop: 4 }}>{i.title}</div>
            <div className="tiny muted">{i.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
