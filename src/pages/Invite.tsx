import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { roleLabel } from '../lib/labels'
import type { Enums } from '../lib/database.types'

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
      <div className="card auth-card stack">
        {loadError && (
          <>
            <div className="card-title">Meghívó</div>
            <div className="alert error">{loadError}</div>
            <a className="btn secondary sm" href="/">Belépési oldal</a>
          </>
        )}

        {!loadError && !info && <div className="spinner" style={{ margin: '20px auto' }} />}

        {info && session && (
          <>
            <div className="card-title">Meghívó</div>
            <div className="alert info">
              Jelenleg be vagy jelentkezve. A meghívó elfogadásához előbb jelentkezz ki.
            </div>
            <button className="btn secondary" onClick={() => { void signOut().then(() => window.location.reload()) }}>
              Kijelentkezés és folytatás
            </button>
          </>
        )}

        {info && !session && (
          <>
            <div className="card-title">🎉 Meghívtak az Alza appba</div>
            <p className="small">
              <strong>{info.full_name || info.email}</strong>, csatlakozol a(z){' '}
              <strong>{info.workspace}</strong> munkaterülethez mint{' '}
              <strong>{roleLabel[info.role]}</strong>.
            </p>
            <div className="between">
              <span className="muted small">Email</span>
              <span className="small">{info.email}</span>
            </div>
            <div className="field">
              <label>Jelszó (legalább 8 karakter)</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="field">
              <label>Jelszó még egyszer</label>
              <input className="input" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
            </div>
            {error && <div className="alert error">{error}</div>}
            <button className="btn" disabled={busy || !password || !password2} onClick={() => void redeem()}>
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
