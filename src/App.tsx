import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import InvitePage from './pages/Invite'
import { isCrewRole } from './lib/labels'
import Login from './pages/Login'
import Pending from './pages/Pending'
import AppShell from './components/AppShell'
import Home from './pages/Home'
import ProfilePage from './pages/Profile'
import ResetPassword from './pages/ResetPassword'
import { RECOVERY_PATH } from './lib/recovery'

// Útvonalankénti kódfelbontás: minden oldal külön darabban töltődik, csak
// akkor, amikor először megnyitják. A sofőr így nem hordja magával a
// beosztás-szerkesztőt/bért/statisztikát, a vezető pedig a QR-olvasót.
// A service worker a darabokat is előre cache-eli, így offline is működnek.
const Scan = lazy(() => import('./pages/Scan'))
const Inspection = lazy(() => import('./pages/Inspection'))
const Fuel = lazy(() => import('./pages/Fuel'))
const Incident = lazy(() => import('./pages/Incident'))
const RoutePage = lazy(() => import('./pages/Route'))
const MySchedule = lazy(() => import('./pages/MySchedule'))
const CarIssues = lazy(() => import('./pages/CarIssues'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Reports = lazy(() => import('./pages/Reports'))
const FleetMap = lazy(() => import('./pages/FleetMap'))
const Approvals = lazy(() => import('./pages/Approvals'))
const Members = lazy(() => import('./pages/Members'))
const Cars = lazy(() => import('./pages/Cars'))
const ManagerRouteUpload = lazy(() => import('./pages/ManagerRouteUpload'))
const ShiftEditor = lazy(() => import('./pages/ShiftEditor'))
const Adjustments = lazy(() => import('./pages/Adjustments'))
const Evidence = lazy(() => import('./pages/Evidence'))
const Payroll = lazy(() => import('./pages/Payroll'))
const Statistics = lazy(() => import('./pages/Statistics'))
const PhotoReview = lazy(() => import('./pages/PhotoReview'))
const History = lazy(() => import('./pages/History'))
const AuditLog = lazy(() => import('./pages/AuditLog'))

function FullScreenSpinner() {
  return <div className="center-screen"><div className="spinner" /></div>
}

function PageSpinner() {
  return <div className="card"><div className="spinner" /></div>
}

// A profil nem töltődött be (pl. gyenge hálózat) — újrapróbálás örök spinner helyett.
function ProfileRetry() {
  const { refreshProfile, signOut } = useAuth()
  return (
    <div className="center-screen">
      <div className="card stack" style={{ maxWidth: 340 }}>
        <div className="card-title">Nem sikerült betölteni a profilod</div>
        <p className="small muted">Ellenőrizd a kapcsolatot, majd próbáld újra.</p>
        <button className="btn" onClick={() => void refreshProfile()}>Újrapróbálás</button>
        <button className="btn ghost sm" onClick={() => void signOut()}>Kijelentkezés</button>
      </div>
    </div>
  )
}

export default function App() {
  const { session, profile, loading, recovery, endRecovery } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  // Meghívó-oldal: bejelentkezés NÉLKÜL is elérhető (a token a jogosultság)
  const inviteMatch = pathname.match(/^\/meghivo\/([0-9a-f-]{36})$/i)
  if (inviteMatch) return <InvitePage token={inviteMatch[1]} />

  if (loading) return <FullScreenSpinner />

  // Emailes jelszó-visszaállítás: minden más elé vág (a link "recovery"
  // munkamenettel léptet be — az appot csak az új jelszó után mutatjuk).
  // A kilépés router-navigációval megy: a puszta history.replaceState-ről a
  // react-router nem értesül, és a képernyő beragadna.
  if (recovery || pathname === RECOVERY_PATH) {
    return <ResetPassword onDone={() => { endRecovery(); navigate('/', { replace: true }) }} />
  }
  if (!session) return <Login />
  if (!profile) return <ProfileRetry />
  if (profile.status !== 'active' || !profile.role) return <Pending />

  const role = profile.role
  const isCrew = isCrewRole(role)
  const isManagerOrAdmin = role === 'manager' || role === 'admin'
  const isAdmin = role === 'admin'

  return (
    <AppShell>
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/profil" element={<ProfilePage />} />

          {/* Crew */}
          {isCrew && <Route path="/beolvasas" element={<Scan />} />}
          {isCrew && <Route path="/ellenorzes" element={<Inspection />} />}
          {isCrew && <Route path="/tankolas" element={<Fuel />} />}
          {isCrew && <Route path="/esemeny" element={<Incident />} />}
          {isCrew && <Route path="/fuvar" element={<RoutePage />} />}
          {isCrew && <Route path="/beosztas" element={<MySchedule />} />}
          {(isCrew || isManagerOrAdmin) && <Route path="/hibak" element={<CarIssues />} />}

          {/* Manager / admin */}
          {isManagerOrAdmin && <Route path="/attekintes" element={<Dashboard />} />}
          {isManagerOrAdmin && <Route path="/riportok" element={<Reports />} />}
          {isManagerOrAdmin && <Route path="/terkep" element={<FleetMap />} />}
          {isManagerOrAdmin && <Route path="/jovahagyas" element={<Approvals />} />}
          {isManagerOrAdmin && <Route path="/tagok" element={<Members />} />}
          {isManagerOrAdmin && <Route path="/autok" element={<Cars />} />}
          {isManagerOrAdmin && <Route path="/fuvar-feltoltes" element={<ManagerRouteUpload />} />}
          {isManagerOrAdmin && <Route path="/beosztas-szerkeszto" element={<ShiftEditor />} />}
          {isManagerOrAdmin && <Route path="/elolegek" element={<Adjustments />} />}
          {isManagerOrAdmin && <Route path="/bizonyitek" element={<Evidence />} />}
          {isAdmin && <Route path="/ber" element={<Payroll />} />}
          {isAdmin && <Route path="/statisztika" element={<Statistics />} />}
          {isManagerOrAdmin && <Route path="/kepek" element={<PhotoReview />} />}
          {isManagerOrAdmin && <Route path="/tortenet" element={<History />} />}
          {isAdmin && <Route path="/naplo" element={<AuditLog />} />}

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  )
}
