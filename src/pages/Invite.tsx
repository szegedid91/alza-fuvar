import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { roleLabel } from '../lib/labels'
import type { Enums } from '../lib/database.types'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'

interface InviteInfo {
  email: string
  full_name: string | null
  workspace: string
  role: Enums<'user_role'>
}

// Publikus meghívó-oldal (/meghivo/:token): a meghívottnak csak jelszót kell
// beállítania — a fiók azonnal aktív, jóváhagyásra sem kell várnia.
export default function InvitePage({ token }: { token: string }) {
  const { session, signOut } = useAuth()
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'form' | 'signing-in'>('form')
  // Telefonon a gépelt jelszó megmutatása kevesebb elgépelést jelent
  const [show, setShow] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      const { data, error } = await supabase.functions.invoke('redeem-invite', {
        body: { action: 'info', token },
      })
      if (!active) return
      if (error) {
        // A függvény hibaüzenete a response bodyban van
        try {
          const body = await (error as { context?: Response }).context?.json()
          setLoadError(body?.error ?? 'A meghívó nem érhető el')
        } catch {
          setLoadError('A meghívó nem érhető el')
        }
        return
      }
      if (data?.error) { setLoadError(data.error); return }
      setInfo(data as InviteInfo)
    })()
    return () => { active = false }
  }, [token])

  async function redeem() {
    if (!info) return
    setError(null)
    if (password.length < 8) { setError('A jelszó legalább 8 karakter legyen.'); return }
    if (password !== password2) { setError('A két jelszó nem egyezik.'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('redeem-invite', {
        body: { action: 'redeem', token, password },
      })
      if (error) {
        try {
          const body = await (error as { context?: Response }).context?.json()
          throw new Error(body?.error ?? 'A meghívó beváltása nem sikerült')
        } catch (e) {
          throw e instanceof Error ? e : new Error('A meghívó beváltása nem sikerült')
        }
      }
      if (data?.error) throw new Error(data.error)
      // Fiók kész — automatikus belépés, majd a főoldal
      setPhase('signing-in')
      const { error: sErr } = await supabase.auth.signInWithPassword({ email: info.email, password })
      if (sErr) throw new Error('A fiók elkészült, de a belépés nem sikerült: ' + sErr.message)
      window.location.href = '/'
    } catch (e) {
      setPhase('form')
      setError(e instanceof Error ? e.message : 'Hiba történt')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo">
        <img src="/pwa-192.png" alt="" />
        <h1>Alza Fuvarszervező</h1>
      </div>
      <div className="card auth-card stack primary">
        {loadError && (
          <>
            <div className="card-title"><Icon name="mail" />Meghívó</div>
            <div className="alert error row" style={{ gap: 8, alignItems: 'flex-start' }}><Icon name="alert-circle" style={{ flexShrink: 0 }} /><span>{loadError}</span></div>
            <p className="tiny muted" style={{ margin: 0 }}>Ha a link lejárt vagy már felhasználták, kérj újat a menedzseredtől.</p>
            <a className="btn secondary" href="/" style={{ textDecoration: 'none' }}><Icon name="log-in" />Belépési oldal</a>
          </>
        )}

        {!loadError && !info && <Skeleton rows={4} card={false} />}

        {info && session && (
          <>
            <div className="card-title"><Icon name="mail" />Meghívó</div>
            <div className="alert info row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <Icon name="info" style={{ flexShrink: 0 }} />
              <span>Jelenleg be vagy jelentkezve. A meghívó elfogadásához előbb jelentkezz ki.</span>
            </div>
            <button className="btn secondary" onClick={() => { void signOut().then(() => window.location.reload()) }}>
              <Icon name="log-out" />Kijelentkezés és folytatás
            </button>
          </>
        )}

        {info && !session && (
          <>
            <div className="card-title"><Icon name="sparkles" />Meghívtak az Alza appba</div>
            <p className="small" style={{ margin: 0 }}>
              <strong>{info.full_name || info.email}</strong>, csatlakozol a(z){' '}
              <strong>{info.workspace}</strong> munkaterülethez mint{' '}
              <strong>{roleLabel[info.role]}</strong>.
            </p>
            <div className="between" style={{ gap: 10 }}>
              <span className="muted small" style={{ flexShrink: 0 }}>Email</span>
              <span className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={info.email}>{info.email}</span>
            </div>
            <div className="field">
              <label htmlFor="ip">Jelszó</label>
              <div className="input-icon input-icon-right">
                <input id="ip" className="input" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="legalább 8 karakter" autoComplete="new-password" />
                <button type="button" className="icon-btn" aria-label={show ? 'Jelszó elrejtése' : 'Jelszó mutatása'} onClick={() => setShow((v) => !v)}>
                  <Icon name={show ? 'eye-off' : 'eye'} size={18} />
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="ip2">Jelszó még egyszer</label>
              <input id="ip2" className="input" type={show ? 'text' : 'password'} value={password2} onChange={(e) => setPassword2(e.target.value)}
                placeholder="ugyanaz még egyszer" autoComplete="new-password" />
              {password2 && password !== password2 && <div className="tiny" style={{ color: 'var(--error-text)' }}>A két jelszó még nem egyezik.</div>}
              {password2 && password === password2 && password.length >= 8 && <div className="tiny" style={{ color: 'var(--success-text)' }}>Egyezik.</div>}
            </div>
            {error && <div className="alert error row" style={{ gap: 8, alignItems: 'flex-start' }}><Icon name="alert-circle" style={{ flexShrink: 0 }} /><span>{error}</span></div>}
            <button className="btn" disabled={busy || !password || !password2} onClick={() => void redeem()}>
              <Icon name="log-in" />
              {phase === 'signing-in' ? 'Belépés…' : busy ? 'Fiók létrehozása…' : 'Jelszó beállítása és belépés'}
            </button>
            <p className="tiny muted" style={{ margin: 0 }}>
              A jelszó beállítása után azonnal be is lépünk — nem kell külön jóváhagyásra várnod.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
