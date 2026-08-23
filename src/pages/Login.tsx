import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { DEV_LOGIN_ENABLED, DEV_ACCOUNTS, type DevAccount } from '../lib/devAuth'

type Mode = 'login' | 'register'

export default function Login() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [devBusy, setDevBusy] = useState<string | null>(null)

  async function handleDevLogin(acc: DevAccount) {
    setError(null)
    setInfo(null)
    setDevBusy(acc.key)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: acc.email, password: acc.password })
      if (error) throw error
      // Az onAuthStateChange innen átveszi és betölti a profilt.
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ismeretlen hiba'
      setError(`Fejlesztői belépés sikertelen (${acc.label}): ${translateAuthError(msg)}`)
    } finally {
      setDevBusy(null)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        })
        if (error) throw error
        if (data.session) {
          // Auto-belépett -> az App a "várj jóváhagyásra" képernyőt mutatja
          setInfo('Sikeres regisztráció. Várj a jóváhagyásra.')
        } else {
          setInfo('Regisztráció elküldve. Ha email-megerősítés szükséges, ellenőrizd a postafiókod, majd lépj be.')
          setMode('login')
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ismeretlen hiba'
      setError(translateAuthError(msg))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo">
        <img src="/pwa-192.png" alt="Alza" />
        <h1>Alza Fuvarszervező</h1>
        <p className="muted small">Sofőr &amp; rakodó napi munkafolyamat</p>
      </div>

      <div className="card auth-card">
        <div className="tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(null); setInfo(null) }} type="button">
            Belépés
          </button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(null); setInfo(null) }} type="button">
            Regisztráció
          </button>
        </div>

        <form className="stack" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="field">
              <label htmlFor="name">Teljes név</label>
              <input id="name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Kovács János" autoComplete="name" required />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email cím</label>
            <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pelda@email.hu" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="pw">Jelszó</label>
            <input id="pw" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} required />
          </div>

          {error && <div className="alert error">{error}</div>}
          {info && <div className="alert success">{info}</div>}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Folyamatban…' : mode === 'login' ? 'Belépés' : 'Regisztráció'}
          </button>
        </form>
      </div>

      {DEV_LOGIN_ENABLED && (
        <div className="card auth-card" style={{ borderColor: 'var(--warning)', borderStyle: 'dashed' }}>
          <div className="card-title" style={{ color: 'var(--warning)' }}>🧪 Gyors belépés (fejlesztői)</div>
          <p className="tiny muted" style={{ marginTop: 0 }}>
            Csak fejlesztői módban látszik. Válaszd ki, melyik fiókkal szeretnél belépni. A munkatársak napi
            szerepe (sofőr/rakodó) a menedzser beosztásából derül ki, nem itt.
          </p>
          <div className="grid-2">
            {DEV_ACCOUNTS.map((acc) => (
              <button
                key={acc.key}
                type="button"
                className="list-item"
                style={{ cursor: 'pointer', textAlign: 'left' }}
                disabled={devBusy !== null}
                onClick={() => handleDevLogin(acc)}
              >
                <div style={{ fontSize: 24 }}>{acc.icon}</div>
                <div className="name" style={{ fontSize: 15, marginTop: 4 }}>{acc.label}</div>
                <div className="tiny muted">{devBusy === acc.key ? 'Belépés…' : acc.sub}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="tiny muted" style={{ maxWidth: 340, textAlign: 'center' }}>
        Új fiók regisztráció után jóváhagyásra vár. Amíg egy menedzser jóvá nem hagy és munkaterülethez nem rendel, nem látsz adatot.
      </p>
    </div>
  )
}

function translateAuthError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Hibás email cím vagy jelszó.'
  if (m.includes('email not confirmed')) return 'Az email cím még nincs megerősítve.'
  if (m.includes('user already registered')) return 'Ezzel az email címmel már van fiók.'
  if (m.includes('password should be at least')) return 'A jelszó túl rövid (min. 6 karakter).'
  if (m.includes('unable to validate email')) return 'Érvénytelen email cím.'
  return msg
}
