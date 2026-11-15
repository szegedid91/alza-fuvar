import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { DEV_ACCOUNTS, type DevAccount } from '../lib/devAuth'
import { clearTestEvents, getUseRealCamera, setUseRealCamera, useTestEvents, type TestEvent } from '../lib/testMode'
import { errMsg } from '../lib/errors'
import { toast } from '../lib/toast'
import { SwitchRow } from './Switch'

// TESZTMÓD panel — CSAK a gépen, a fejlesztői szerveren (localhost) látszik; az éles appban nincs.
// A futár napja innen telefon nélkül végigpróbálható: a nap egy gombbal újraindul, a kamera helyett
// tesztkép megy, a WhatsApp és a navigáció helyett pedig itt látszik, mi ment volna ki.
const AMBER = '#f59e0b'
const hhmmss = (d: Date) => d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function EventCard({ e, onClose }: { e: TestEvent; onClose?: () => void }) {
  return (
    <div style={{ border: `1px solid ${AMBER}`, borderRadius: 10, padding: '8px 10px', background: 'var(--bg-elev-2, #1e293b)' }}>
      <div className="between" style={{ gap: 8 }}>
        <span className="tiny" style={{ fontWeight: 800, color: AMBER }}>{e.kind === 'nav' ? '🧭' : '💬'} {e.title} · {hhmmss(e.at)}</span>
        {onClose && <button type="button" className="link-btn tiny" style={{ padding: 0 }} onClick={onClose}>bezár</button>}
      </div>
      <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{e.body}</div>
      {e.url && <a className="tiny" href={e.url} target="_blank" rel="noopener noreferrer" style={{ color: AMBER }}>megnyitás a térképen</a>}
    </div>
  )
}

export default function TestModePanel() {
  const { profile, signOut } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const events = useTestEvents()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [withInspection, setWithInspection] = useState(false)
  const [realCam, setRealCam] = useState(() => getUseRealCamera())
  const [msg, setMsg] = useState<string | null>(null)

  // az új „kiküldés” pár másodpercre felvillan a képernyő tetején (a panel megnyitása nélkül is látszik)
  const [flash, setFlash] = useState<TestEvent | null>(null)
  const lastId = useRef(0)
  useEffect(() => {
    const top = events[0]
    if (!top || top.id === lastId.current) return
    lastId.current = top.id
    setFlash(top)
    const t = setTimeout(() => setFlash((f) => (f?.id === top.id ? null : f)), 9000)
    return () => clearTimeout(t)
  }, [events])

  async function resetDay() {
    setBusy('reset'); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('test_day_reset' as never, { p_inspection: withInspection } as never)
      if (error) throw error
      // a készüléken tárolt napi jelölők is törlődnek (elküldött box-lapok, átvitt késés-ok)
      try {
        Object.keys(localStorage).filter((k) => k.startsWith('box-sent:')).forEach((k) => localStorage.removeItem(k))
        Object.keys(sessionStorage).filter((k) => k.startsWith('late-carry:')).forEach((k) => sessionStorage.removeItem(k))
      } catch { /* nem kritikus */ }
      clearTestEvents()
      await qc.invalidateQueries()
      const r = data as unknown as { shifts?: { round: number; route: string | null; plate: string }[]; shift_created?: boolean } | null
      const shifts = (r?.shifts ?? []).map((s) => `${s.plate}${s.route ? ` · ${s.route} járat` : ''}${(r?.shifts?.length ?? 0) > 1 ? ` · ${s.round}. kör` : ''}`).join(', ')
      setMsg(`A mai nap újraindítva. Beosztás: ${shifts || 'nincs'}${r?.shift_created ? ' (most kapta)' : ''}. Kezdd a becsekkolással.`)
      toast.success('Tesztnap újraindítva')
      setOpen(false)
      navigate('/')
    } catch (e) {
      setMsg(errMsg(e, 'Az újraindítás nem sikerült').replace(/^TEST_ONLY:\s*/, ''))
    } finally { setBusy(null) }
  }

  async function switchTo(acc: DevAccount) {
    setBusy(acc.key); setMsg(null)
    try {
      await signOut()
      const { error } = await supabase.auth.signInWithPassword({ email: acc.email, password: acc.password })
      if (error) throw error
      window.location.assign('/')
    } catch (e) {
      setMsg(`A fiókváltás nem sikerült (${acc.label}): ${errMsg(e, 'ismeretlen hiba')}`)
      setBusy(null)
    }
  }

  return (
    <>
      {flash && !open && (
        <div style={{ position: 'fixed', left: 8, right: 8, top: 'calc(env(safe-area-inset-top) + 56px)', zIndex: 300, maxWidth: 520, margin: '0 auto', boxShadow: '0 8px 24px rgba(0,0,0,.45)', borderRadius: 10 }}>
          <EventCard e={flash} onClose={() => setFlash(null)} />
        </div>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{ position: 'fixed', left: 8, bottom: 'calc(env(safe-area-inset-bottom) + 150px)', zIndex: 90, border: `1px solid ${AMBER}`, background: '#451a03', color: AMBER, borderRadius: 999, padding: '6px 12px', fontWeight: 800, fontSize: 12, cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,.4)' }}>
        🧪 TESZT{events.length ? ` · ${events.length}` : ''}
      </button>
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 302, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setOpen(false)}>
          <div className="card stack" style={{ width: '100%', maxWidth: 560, maxHeight: '86vh', overflowY: 'auto', borderColor: AMBER, borderRadius: '16px 16px 0 0', margin: 0, gap: 12 }} onClick={(e) => e.stopPropagation()}>
            <div className="between">
              <div style={{ fontWeight: 800, color: AMBER }}>🧪 Tesztmód — csak ezen a gépen</div>
              <button type="button" className="btn ghost sm auto" onClick={() => setOpen(false)}>Bezár</button>
            </div>
            <div className="tiny muted">
              Belépve: <strong>{profile?.full_name || profile?.email || '—'}</strong>. A kamera helyett tesztkép megy, a WhatsApp és a navigáció nem nyílik meg — alul látod, mi ment volna ki. Az éles appban ez a panel nincs.
            </div>

            <div className="stack" style={{ gap: 6 }}>
              <button type="button" className="btn" disabled={busy != null} onClick={() => void resetDay()}>
                {busy === 'reset' ? 'Újraindítás…' : 'Tesztnap újraindítása (a mai napom elölről)'}
              </button>
              <label className="row tiny" style={{ gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={withInspection} onChange={(e) => setWithInspection(e.target.checked)} />
                az autó-ellenőrzés (fotók) is elölről
              </label>
              <div className="tiny muted">Törli a tesztfutár mai becsekkolását, jelzéseit, Box-lapját és járat-haladását. Ha mára nincs beosztása, kap egy szabad autót és járatot.</div>
              {msg && <div className="small" style={{ color: AMBER }}>{msg}</div>}
            </div>

            {DEV_ACCOUNTS.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="small" style={{ fontWeight: 700 }}>Fiókváltás</div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {DEV_ACCOUNTS.map((a) => (
                    <button key={a.key} type="button" className="btn ghost sm auto" disabled={busy != null} onClick={() => void switchTo(a)}>
                      {a.icon} {busy === a.key ? 'Belépés…' : a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <SwitchRow title="Valódi kamera (ha van a gépen)" on={realCam} hint={realCam ? 'ha nem indul, tesztkép' : 'tesztkép megy'}
              onChange={(v) => { setUseRealCamera(v); setRealCam(v) }} />

            <div className="stack" style={{ gap: 6 }}>
              <div className="between">
                <div className="small" style={{ fontWeight: 700 }}>Mi ment volna ki ({events.length})</div>
                {events.length > 0 && <button type="button" className="link-btn tiny" style={{ padding: 0 }} onClick={clearTestEvents}>lista törlése</button>}
              </div>
              {events.length === 0 && <div className="tiny muted">Még semmi. A csoportba menő üzenetek és a navigáció-indítások itt jelennek meg.</div>}
              {events.map((e) => <EventCard key={e.id} e={e} />)}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
