import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { roleLabel, statusLabel, isCrewRole } from '../lib/labels'
import { pushSupported, isPushSubscribed, subscribePush, unsubscribePush } from '../lib/push'
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme'
import { RECOVERY_PATH } from '../lib/recovery'
import Icon, { type IconName } from '../components/Icon'

const THEME_UI: Record<ThemePref, { icon: IconName; label: string }> = {
  system: { icon: 'monitor', label: 'Rendszer' },
  light: { icon: 'sun', label: 'Világos' },
  dark: { icon: 'moon', label: 'Sötét' },
}
import { toast } from '../lib/toast'

export default function ProfilePage() {
  const { profile, signOut, refreshProfile } = useAuth()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pwBusy, setPwBusy] = useState(false)

  // Jelszó módosítása: ugyanaz az emailes link, mint az "Elfelejtettem" — a
  // felhasználó a saját címére kapja, és a linken állít be újat
  async function sendPasswordReset() {
    if (!profile?.email) return
    setPwBusy(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
        redirectTo: `${window.location.origin}${RECOVERY_PATH}`,
      })
      if (error) throw error
      toast.success('Elküldtük a jelszó-módosító linket az email címedre.')
    } catch (e) {
      toast.error('Nem sikerült elküldeni: ' + (e instanceof Error ? e.message : 'ismeretlen hiba'))
    } finally {
      setPwBusy(false)
    }
  }

  async function save() {
    if (!profile) return
    setBusy(true)
    setMsg(null)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null })
      .eq('id', profile.id)
    if (error) setMsg('Hiba: ' + error.message)
    else { toast.success('Profil mentve.'); await refreshProfile() }
    setBusy(false)
  }

  return (
    <div className="stack">
      <div className="card stack primary">
        <div className="card-title"><Icon name="user" />Adataim</div>
        <div className="field">
          <label>Teljes név</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="field">
          <label>Telefonszám</label>
          <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+36 30 123 4567" />
          <div className="tiny muted">
            {isCrewRole(profile?.role)
              ? 'A társad ezen a számon tud hívni a beosztásból.'
              : 'A munkatársak a Beosztásom oldalon, a vezetők a Tagok oldalon látják ezt a számot.'}
          </div>
        </div>
        {msg && <div className={`alert ${msg.startsWith('Hiba') ? 'error' : 'success'}`}>{msg}</div>}
        {/* Üres név nem menthető — a név mindenhol megjelenik (beosztás, bér, napló) */}
        <button className="btn" onClick={() => void save()} disabled={busy || !fullName.trim()}><Icon name="save" />{busy ? 'Mentés…' : 'Mentés'}</button>
        {!fullName.trim() && <div className="tiny muted" style={{ textAlign: 'center' }}>Add meg a teljes neved — ez jelenik meg a beosztásban és a bérlapon.</div>}
      </div>

      <div className="card stack">
        <div className="card-title"><Icon name="shield-check" />Fiók</div>
        <div className="between"><span className="muted small">Email</span><span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.email}</span></div>
        <div className="between"><span className="muted small">Szerep</span><span className="badge primary">{profile?.role ? roleLabel[profile.role] : '–'}</span></div>
        <div className="between"><span className="muted small">Állapot</span><span className="badge success">{profile ? statusLabel[profile.status] : '–'}</span></div>
        <button className="btn ghost sm" disabled={pwBusy} onClick={() => void sendPasswordReset()}>
          <Icon name="key" />{pwBusy ? 'Küldés…' : 'Jelszó módosítása (emailes link)'}
        </button>
      </div>

      <ThemeCard />

      <PushCard />

      <button className="btn danger-outline" onClick={() => void signOut()}><Icon name="log-out" />Kilépés</button>

      <p className="tiny muted" style={{ textAlign: 'center', margin: 0 }}>
        Verzió: {new Date(__BUILD_TIME__).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' })}
      </p>
    </div>
  )
}

function ThemeCard() {
  const [pref, setPref] = useState<ThemePref>(() => getThemePref())
  const options: ThemePref[] = ['system', 'light', 'dark']
  return (
    <div className="card stack">
      <div className="card-title"><Icon name="sun" />Megjelenés</div>
      <div className="tabs compact" style={{ margin: 0 }}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className={pref === o ? 'active' : ''}
            onClick={() => { setThemePref(o); setPref(o) }}
          >
            <Icon name={THEME_UI[o].icon} size={18} />{THEME_UI[o].label}
          </button>
        ))}
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        „Rendszer”: a telefon/számítógép sötét-világos beállítását követi.
      </p>
    </div>
  )
}

function PushCard() {
  const { profile } = useAuth()
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const supported = pushSupported()

  useEffect(() => { void isPushSubscribed().then(setSubscribed) }, [])

  async function toggle() {
    if (!profile) return
    setBusy(true); setErr(null)
    try {
      if (subscribed) { await unsubscribePush(); setSubscribed(false) }
      else { await subscribePush(profile.id); setSubscribed(true) }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Hiba')
    } finally { setBusy(false) }
  }

  if (!supported) return null
  return (
    <div className="card stack">
      <div className="card-title"><Icon name="bell" />Értesítések</div>
      <div className="between">
        <span className="small muted">Push-értesítések ezen az eszközön</span>
        <span className={`badge ${subscribed ? 'success' : ''}`}>{subscribed ? 'Bekapcsolva' : 'Kikapcsolva'}</span>
      </div>
      {err && <div className="alert error">{err}</div>}
      <button className={`btn sm ${subscribed ? 'ghost' : 'secondary'}`} disabled={busy} onClick={() => void toggle()}>
        <Icon name="bell" />{busy ? '…' : subscribed ? 'Kikapcsolás' : 'Értesítések bekapcsolása'}
      </button>
    </div>
  )
}
