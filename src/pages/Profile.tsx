import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { roleLabel, statusLabel } from '../lib/labels'
import { pushSupported, isPushSubscribed, subscribePush, unsubscribePush } from '../lib/push'
import { getThemePref, setThemePref, themeLabel, type ThemePref } from '../lib/theme'

export default function ProfilePage() {
  const { profile, signOut, refreshProfile } = useAuth()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function save() {
    if (!profile) return
    setBusy(true)
    setMsg(null)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null })
      .eq('id', profile.id)
    if (error) setMsg('Hiba: ' + error.message)
    else { setMsg('Mentve.'); await refreshProfile() }
    setBusy(false)
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div className="card-title">Profil</div>
        <div className="field">
          <label>Teljes név</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="field">
          <label>Telefonszám</label>
          <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+36…" />
        </div>
        {msg && <div className={`alert ${msg.startsWith('Hiba') ? 'error' : 'success'}`}>{msg}</div>}
        <button className="btn" onClick={() => void save()} disabled={busy}>{busy ? 'Mentés…' : 'Mentés'}</button>
      </div>

      <div className="card stack">
        <div className="card-title">Fiók</div>
        <div className="between"><span className="muted small">Email</span><span className="small">{profile?.email}</span></div>
        <div className="between"><span className="muted small">Szerep</span><span className="badge primary">{profile?.role ? roleLabel[profile.role] : '–'}</span></div>
        <div className="between"><span className="muted small">Állapot</span><span className="badge success">{profile ? statusLabel[profile.status] : '–'}</span></div>
      </div>

      <ThemeCard />

      <PushCard />

      <button className="btn danger" onClick={() => void signOut()}>Kilépés</button>

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
      <div className="card-title">Megjelenés</div>
      <div className="grid-3">
        {options.map((o) => (
          <button
            key={o}
            className={`btn sm ${pref === o ? '' : 'secondary'}`}
            onClick={() => { setThemePref(o); setPref(o) }}
          >
            {themeLabel[o]}
          </button>
        ))}
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        „Rendszer": a telefon/számítógép sötét-világos beállítását követi.
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
      <div className="card-title">Értesítések</div>
      <div className="between">
        <span className="small muted">Push értesítések ezen az eszközön</span>
        <span className={`badge ${subscribed ? 'success' : ''}`}>{subscribed ? 'Bekapcsolva' : 'Kikapcsolva'}</span>
      </div>
      {err && <div className="alert error">{err}</div>}
      <button className={`btn sm ${subscribed ? 'ghost' : 'secondary'}`} disabled={busy} onClick={() => void toggle()}>
        {busy ? '…' : subscribed ? 'Kikapcsolás' : 'Értesítések bekapcsolása'}
      </button>
    </div>
  )
}
