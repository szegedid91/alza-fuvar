import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { DEV_LOGIN_ENABLED, DEV_LOGIN_SETUP_HINT, DEV_ACCOUNTS, type DevAccount } from '../lib/devAuth'
import { RECOVERY_PATH } from '../lib/recovery'
import Icon, { type IconName } from '../components/Icon'

// Fejlesztői fiókok ikonja a címke/leírás alapján — az .env-beli emoji helyett
function devIcon(acc: DevAccount): IconName {
  const t = `${acc.sub} ${acc.label} ${acc.key}`.toLowerCase()
  if (/admin/.test(t)) return 'shield-check'
  if (/mened|manag/.test(t)) return 'users'
  return 'user'
}

type Mode = 'login' | 'register' | 'forgot'

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
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}${RECOVERY_PATH}`,
        })
        if (error) throw error
        // Szándékosan nem áruljuk el, létezik-e a fiók (email-felderítés ellen)
        setInfo('Ha van fiók ezzel az email címmel, elküldtük rá a jelszó-visszaállító linket. Nézd meg a postafiókod (a spam mappát is).')
      } else if (mode === 'login') {
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
        } else if (data.user && (data.user.identities?.length ?? 0) === 0) {
          // Megerősítés bekapcsolva + már létező email: a Supabase "üres" usert ad
          // vissza, hogy ne árulja el a fiók létét — mi a belépés felé tereljük
          setInfo('Ha ezzel az email címmel már van fiók, lépj be vele — vagy kérj új jelszót az „Elfelejtettem a jelszavam” gombbal.')
          setMode('login')
        } else {
          // Nincs azonnali munkamenet = email-megerősítés szükséges (a projekt beállítása)
          setInfo(`Küldtünk egy megerősítő emailt ide: ${email.trim()}. Nyisd meg a benne lévő linket (a spam mappát is nézd meg), utána itt lépj be — a fiókod ezután jóváhagyásra kerül.`)
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

      <div className="card auth-card primary">
        <div className="tabs">
          <button className={mode === 'login' || mode === 'forgot' ? 'active' : ''} onClick={() => { setMode('login'); setError(null); setInfo(null) }} type="button">
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
            <input id="email" className="input" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pelda@email.hu" autoComplete="email" required />
          </div>
          {mode !== 'forgot' && (
            <div className="field">
              <label htmlFor="pw">Jelszó</label>
              <input id="pw" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} required />
            </div>
          )}
          {mode === 'forgot' && (
            <p className="tiny muted" style={{ margin: 0 }}>
              Add meg az email címed, és küldünk egy linket, amivel új jelszót állíthatsz be.
            </p>
          )}

          {error && <div className="alert error row" style={{ gap: 8, alignItems: 'flex-start' }}><Icon name="alert-circle" style={{ flexShrink: 0 }} /><span>{error}</span></div>}
          {info && <div className="alert success row" style={{ gap: 8, alignItems: 'flex-start' }}><Icon name="mail" style={{ flexShrink: 0 }} /><span>{info}</span></div>}

          <button className="btn" type="submit" disabled={busy}>
            <Icon name={mode === 'login' ? 'log-in' : mode === 'register' ? 'user-check' : 'mail'} />
            {busy ? 'Folyamatban…' : mode === 'login' ? 'Belépés' : mode === 'register' ? 'Regisztráció' : 'Visszaállító link kérése'}
          </button>

          {/* Másodlagos műveletek szöveges linkként — a nagy gomb maradjon az egyetlen hangsúly */}
          {mode === 'login' && (
            <button className="link-btn" type="button" onClick={() => { setMode('forgot'); setError(null); setInfo(null) }}>
              Elfelejtettem a jelszavam
            </button>
          )}
          {mode === 'forgot' && (
            <button className="link-btn" type="button" onClick={() => { setMode('login'); setError(null); setInfo(null) }}>
              <Icon name="arrow-left" size={16} />Vissza a belépéshez
            </button>
          )}
        </form>
      </div>


      {DEV_LOGIN_SETUP_HINT && (
        <div className="card auth-card" style={{ borderColor: 'var(--warning)', borderStyle: 'dashed' }}>
          <div className="card-title" style={{ color: 'var(--warning)' }}><Icon name="flask" />Gyors belépés — nincs beállítva</div>
          <p className="tiny muted" style={{ marginTop: 0 }}>
            Helyben futsz, de nincs fejlesztői fiók megadva. Vedd fel őket a projekt
            <strong> .env.local</strong> fájljába egy sorban (a fájl nincs verziókövetve, éles buildbe nem kerül):
          </p>
          <pre className="tiny" style={{
            margin: 0, padding: 10, borderRadius: 8, overflowX: 'auto',
            background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
          }}>
{`VITE_DEV_ACCOUNTS=[{"label":"Munkatárs 1","email":"...","password":"..."}]`}
          </pre>
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            A minta a <strong>.env.example</strong> fájlban van. Mentés után indítsd újra a dev szervert.
          </p>
        </div>
      )}

      {DEV_LOGIN_ENABLED && (
        <div className="card auth-card" style={{ borderColor: 'var(--warning)', borderStyle: 'dashed' }}>
          <div className="card-title" style={{ color: 'var(--warning)' }}><Icon name="flask" />Gyors belépés (fejlesztői)</div>
          <p className="tiny muted" style={{ marginTop: 0 }}>
            Csak helyi futtatásnál látszik. Két munkatárs-fiók van, hogy a páros is tesztelhető legyen
            (a napi sofőr/rakodó szerep a beosztásból jön).
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
                <Icon name={devIcon(acc)} size={24} style={{ color: 'var(--primary)' }} />
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
  if (m.includes('rate limit') || m.includes('too many requests')) return 'Túl sok próbálkozás — várj pár percet, és próbáld újra.'
  if (m.includes('for security purposes')) return 'Biztonsági okból várni kell egy kicsit két kérés között — próbáld újra pár másodperc múlva.'
  return msg
}
