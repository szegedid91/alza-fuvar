import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import InvitePage from './pages/Invite'
import { isCrewRole } from './lib/labels'
import Login from './pages/Login'
import Pending from './pages/Pending'
import AppShell from './components/AppShell'
import Home from './pages/Home'
import Approvals from './pages/Approvals'
import Members from './pages/Members'
import ProfilePage from './pages/Profile'
import Scan from './pages/Scan'
import Cars from './pages/Cars'
import Inspection from './pages/Inspection'
import Fuel from './pages/Fuel'
import Incident from './pages/Incident'
import Evidence from './pages/Evidence'
import ShiftEditor from './pages/ShiftEditor'
import MySchedule from './pages/MySchedule'
import Adjustments from './pages/Adjustments'
import RoutePage from './pages/Route'
import Payroll from './pages/Payroll'
import PhotoReview from './pages/PhotoReview'
import Dashboard from './pages/Dashboard'
import ManagerRouteUpload from './pages/ManagerRouteUpload'
import AuditLog from './pages/AuditLog'
import CarIssues from './pages/CarIssues'
import Reports from './pages/Reports'
import FleetMap from './pages/FleetMap'

function FullScreenSpinner() {
  return <div className="center-screen"><div className="spinner" /></div>
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
  const { session, profile, loading } = useAuth()
  const { pathname } = useLocation()

  // Meghívó-oldal: bejelentkezés NÉLKÜL is elérhető (a token a jogosultság)
  const inviteMatch = pathname.match(/^\/meghivo\/([0-9a-f-]{36})$/i)
  if (inviteMatch) return <InvitePage token={inviteMatch[1]} />

  if (loading) return <FullScreenSpinner />
  if (!session) return <Login />
  if (!profile) return <ProfileRetry />
  if (profile.status !== 'active' || !profile.role) return <Pending />

  const role = profile.role
  const isCrew = isCrewRole(role)
  const isManagerOrAdmin = role === 'manager' || role === 'admin'
  const isAdmin = role === 'admin'

  return (
    <AppShell>
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
        {isManagerOrAdmin && <Route path="/kepek" element={<PhotoReview />} />}
        {isAdmin && <Route path="/naplo" element={<AuditLog />} />}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
