import { useAuth } from '../context/AuthContext'
import { statusLabel } from '../lib/labels'

export default function Pending() {
  const { profile, signOut, refreshProfile } = useAuth()
  const disabled = profile?.status === 'disabled'

  return (
    <div className="auth-wrap">
      <div className="auth-logo">
        <img src="/pwa-192.png" alt="Alza" />
        <h1>{disabled ? 'Fiók letiltva' : 'Várj a jóváhagyásra'}</h1>
      </div>

      <div className="card auth-card stack">
        <div className={`alert ${disabled ? 'error' : 'info'}`}>
          {disabled
            ? 'A fiókodat letiltották. Vedd fel a kapcsolatot a menedzsereddel.'
            : 'A fiókod regisztrálva van, de még jóváhagyásra vár. Egy menedzsernek engedélyeznie kell, szerepet és munkaterületet kell adnia, mielőtt használhatod az alkalmazást.'}
        </div>

        <div className="between">
          <span className="muted small">Bejelentkezve mint</span>
          <span className="small">{profile?.email}</span>
        </div>
        <div className="between">
          <span className="muted small">Állapot</span>
          <span className="badge warning">{statusLabel[profile?.status ?? 'pending']}</span>
        </div>

        <button className="btn secondary" onClick={() => void refreshProfile()}>Állapot frissítése</button>
        <button className="btn ghost" onClick={() => void signOut()}>Kilépés</button>
      </div>
    </div>
  )
}
