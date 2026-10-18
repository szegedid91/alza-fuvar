import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { statusLabel } from '../lib/labels'
import { pushSupported, isPushSubscribed, subscribePush } from '../lib/push'
import Icon from '../components/Icon'

export default function Pending() {
  const { profile, signOut, refreshProfile } = useAuth()
  const disabled = profile?.status === 'disabled'

  // Várakozás közben is feliratkozhat az értesítésre: a jóváhagyásról így
  // azonnal pusht kap, nem kell az appot nyitogatnia. (A push_subscriptions
  // RLS-e csak a saját sort kéri, aktív státuszt nem.)
  const [pushState, setPushState] = useState<'unknown' | 'off' | 'on' | 'busy' | 'unsupported'>('unknown')
  useEffect(() => {
    if (!pushSupported()) { setPushState('unsupported'); return }
    void isPushSubscribed().then((on) => setPushState(on ? 'on' : 'off'))
  }, [])
  // Automatikus frissítés: 30 mp-enként és az app előtérbe kerülésekor újra
  // lekérjük a profilt — a jóváhagyás után gombnyomás nélkül is beengedjük
  useEffect(() => {
    if (disabled) return
    const tick = () => { if (document.visibilityState === 'visible') void refreshProfile() }
    const id = setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [disabled, refreshProfile])

  async function enablePush() {
    if (!profile) return
    setPushState('busy')
    try { await subscribePush(profile.id); setPushState('on') } catch { setPushState('off') }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo">
        <img src="/pwa-192.png" alt="Alza" />
        <h1>{disabled ? 'Fiók letiltva' : 'Várj a jóváhagyásra'}</h1>
      </div>

      <div className="card auth-card stack primary" style={{ borderColor: disabled ? 'var(--danger)' : undefined }}>
        <div className={`alert ${disabled ? 'error' : 'info'} row`} style={{ gap: 10, alignItems: 'flex-start', fontWeight: 500 }}>
          <Icon name={disabled ? 'ban' : 'clock'} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{disabled
            ? 'A fiókodat letiltották. Vedd fel a kapcsolatot a menedzsereddel.'
            : 'A fiókod regisztrálva van, de még jóváhagyásra vár. Egy menedzsernek engedélyeznie kell, szerepet és munkaterületet kell adnia, mielőtt használhatod az alkalmazást.'}</span>
        </div>

        <div className="between" style={{ gap: 10 }}>
          <span className="muted small" style={{ flexShrink: 0 }}>Bejelentkezve mint</span>
          <span className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={profile?.email ?? ''}>{profile?.email}</span>
        </div>
        <div className="between">
          <span className="muted small">Állapot</span>
          <span className="badge warning">{statusLabel[profile?.status ?? 'pending']}</span>
        </div>

        {!disabled && pushState === 'off' && (
          <button className="btn" onClick={() => void enablePush()}><Icon name="bell" />Értesítést kérek a jóváhagyásról</button>
        )}
        {!disabled && pushState === 'busy' && <button className="btn" disabled><Icon name="bell" />Bekapcsolás…</button>}
        {!disabled && pushState === 'on' && (
          <div className="alert success row" style={{ gap: 8 }}><Icon name="check-circle" />Értesítést kapsz, amint jóváhagyták a fiókod.</div>
        )}
        <button className="btn secondary" onClick={() => void refreshProfile()}><Icon name="refresh" />Állapot frissítése</button>
        {!disabled && <div className="tiny muted" style={{ textAlign: 'center' }}>Az állapot magától is frissül fél percenként — jóváhagyás után azonnal beengedünk.</div>}
        <button className="link-btn" onClick={() => void signOut()}><Icon name="log-out" size={16} />Kilépés</button>
      </div>
    </div>
  )
}
