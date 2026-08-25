import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { RECOVERY_URL_ERROR } from '../lib/recovery'

// Új jelszó beállítása az emailben kapott link után.
// Ilyenkor a Supabase már beléptetett minket egy "recovery" munkamenettel,
// így elég a jelszót frissíteni.
export default function ResetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(RECOVERY_URL_ERROR)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (pw.length < 6) { setError('A jelszó legalább 6 karakter legyen.'); return }
    if (pw !== pw2) { setError('A két jelszó nem egyezik.'); return }
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pw })
      if (error) throw error
      setDone(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ismeretlen hiba'
      const m = msg.toLowerCase()
      setError(
        m.includes('should be at least') ? 'A jelszó túl rövid (min. 6 karakter).'
          : m.includes('same as the old') || m.includes('should be different') ? 'Az új jelszó nem egyezhet a régivel.'
          : m.includes('session') || m.includes('jwt') ? 'A visszaállító link lejárt — kérj újat a bejelentkezési oldalon.'
          : msg,
      )
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="auth-wrap">
        <div className="auth-logo">
          <img src="/pwa-192.png" alt="Alza" />
          <h1>Alza Fuvarszervező</h1>
        </div>
        <div className="card auth-card stack">
          <div className="alert success">✅ A jelszavad frissítve. Mostantól az új jelszóval tudsz belépni.</div>
          <button className="btn" onClick={onDone}>Tovább az appba</button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo">
        <img src="/pwa-192.png" alt="Alza" />
        <h1>Alza Fuvarszervező</h1>
        <p className="muted small">Új jelszó beállítása</p>
      </div>

      <div className="card auth-card">
        <form className="stack" onSubmit={submit}>
          <div className="field">
            <label htmlFor="np">Új jelszó</label>
            <input id="np" className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              placeholder="••••••••" autoComplete="new-password" minLength={6} required />
          </div>
          <div className="field">
            <label htmlFor="np2">Új jelszó még egyszer</label>
            <input id="np2" className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
              placeholder="••••••••" autoComplete="new-password" minLength={6} required />
          </div>

          {error && <div className="alert error">{error}</div>}

          <button className="btn" type="submit" disabled={busy}>{busy ? 'Mentés…' : 'Jelszó mentése'}</button>
          <button className="btn ghost sm" type="button" onClick={() => void supabase.auth.signOut().then(onDone)}>
            Mégse — vissza a belépéshez
          </button>
        </form>
      </div>
    </div>
  )
}
