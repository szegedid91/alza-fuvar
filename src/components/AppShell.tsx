import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import WorkspaceSwitcher from './WorkspaceSwitcher'
import { useOutboxStatus } from '../hooks/useOutbox'
import { isCrewRole } from '../lib/labels'
import { listFailed, retryFailed, discardFailed, flushOutbox, type OutboxRecord } from '../lib/outbox'
import { queryClient } from '../lib/queryClient'
import ConfirmButton from './ConfirmButton'
import { pushSupported, isPushSubscribed, subscribePush } from '../lib/push'

interface NavItem { to: string; icon: string; label: string; end?: boolean }

// Lehúzásra frissítés (pull-to-refresh): a lap tetején lefelé húzva minden
// aktív lekérdezés újratöltődik + az offline sor is szinkronizál.
function PullToRefresh() {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const pullRef = useRef(0)
  const refreshingRef = useRef(false)

  useEffect(() => {
    let startY = 0
    let startX = 0
    let tracking = false
    let pulling = false

    const setP = (v: number) => { pullRef.current = v; setPull(v) }

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || window.scrollY > 2) return
      startY = e.touches[0].clientY
      startX = e.touches[0].clientX
      tracking = true
      pulling = false
    }
    const onMove = (e: TouchEvent) => {
      if (!tracking || refreshingRef.current) return
      const dy = e.touches[0].clientY - startY
      const dx = e.touches[0].clientX - startX
      if (!pulling) {
        // csak felülről induló, dominánsan lefelé húzás számít
        if (window.scrollY > 2 || dy < -6 || Math.abs(dx) > 30) { tracking = false; return }
        if (dy > 14 && dy > Math.abs(dx)) pulling = true
        else return
      }
      if (e.cancelable) e.preventDefault()
      setP(Math.max(0, Math.min(110, (dy - 14) * 0.45)))
    }
    const onEnd = () => {
      if (!tracking) return
      tracking = false
      if (!pulling) return
      pulling = false
      if (pullRef.current >= 55) {
        refreshingRef.current = true
        setRefreshing(true)
        setP(55)
        void (async () => {
          try {
            void flushOutbox()
            // App-frissítés ellenőrzése is: ha új verzió van, a service worker
            // automatikusan aktiválja és újratölti az oldalt
            if ('serviceWorker' in navigator) {
              void navigator.serviceWorker.getRegistrations()
                .then((regs) => Promise.all(regs.map((r) => r.update().catch(() => undefined))))
                .catch(() => undefined)
            }
            await queryClient.refetchQueries({ type: 'active' })
          } finally {
            refreshingRef.current = false
            setRefreshing(false)
            setP(0)
          }
        })()
      } else {
        setP(0)
      }
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  if (pull <= 0 && !refreshing) return null
  const shown = refreshing ? 55 : pull
  const ready = shown >= 55
  return (
    <div
      style={{
        position: 'fixed', left: 0, right: 0, zIndex: 60, pointerEvents: 'none',
        top: `calc(${Math.min(shown, 96) - 46}px + env(safe-area-inset-top))`,
        display: 'flex', justifyContent: 'center',
        transition: refreshing ? 'top .15s ease' : undefined,
      }}
    >
      <div
        style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
          boxShadow: 'var(--shadow)', display: 'grid', placeItems: 'center',
        }}
      >
        {refreshing
          ? <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
          : (
            <span
              style={{
                fontSize: 18, display: 'inline-block', color: ready ? 'var(--primary)' : 'var(--text-dim)',
                transform: `rotate(${Math.min(shown / 55, 1) * 180}deg)`, transition: 'transform .1s',
              }}
            >
              ↓
            </span>
          )}
      </div>
    </div>
  )
}

// Belépés után automatikusan felajánljuk az értesítések bekapcsolását.
// Ha az engedély már megvan, csendben pótoljuk a feliratkozást; ha még nincs,
// bannert mutatunk (a böngésző csak felhasználói kattintásra engedi a kérdést).
function PushPrompt() {
  const { profile } = useAuth()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!profile || profile.status !== 'active') return
    if (!pushSupported()) return
    if (sessionStorage.getItem('alza-push-prompt-dismissed')) return
    let cancelled = false
    void (async () => {
      if (await isPushSubscribed()) return
      if (Notification.permission === 'denied') return
      if (Notification.permission === 'granted') {
        try { await subscribePush(profile.id) } catch { if (!cancelled) setShow(true) }
        return
      }
      if (!cancelled) setShow(true)
    })()
    return () => { cancelled = true }
  }, [profile])

  if (!show) return null

  const enable = async () => {
    if (!profile) return
    setBusy(true)
    setErr(null)
    try {
      await subscribePush(profile.id)
      setShow(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Nem sikerült bekapcsolni az értesítéseket')
    } finally {
      setBusy(false)
    }
  }
  const later = () => {
    sessionStorage.setItem('alza-push-prompt-dismissed', '1')
    setShow(false)
  }

  return (
    <div
      style={{
        position: 'fixed', left: 12, right: 12, zIndex: 80,
        bottom: 'calc(72px + env(safe-area-inset-bottom))',
        display: 'flex', justifyContent: 'center', pointerEvents: 'none',
      }}
    >
      <div
        className="card stack"
        style={{ maxWidth: 440, width: '100%', gap: 8, pointerEvents: 'auto', boxShadow: 'var(--shadow)' }}
      >
        <div style={{ fontWeight: 700 }}>🔔 Értesítések bekapcsolása</div>
        <div className="small muted">
          Kapj azonnali értesítést a beosztásról, cserekérésekről és jóváhagyásokról.
        </div>
        {err && <div className="tiny" style={{ color: 'var(--danger)' }}>{err}</div>}
        <div className="btn-grid">
          <button className="btn sm" disabled={busy} onClick={() => void enable()}>
            {busy ? 'Bekapcsolás…' : 'Bekapcsolom'}
          </button>
          <button className="btn ghost sm" disabled={busy} onClick={later}>Most nem</button>
        </div>
      </div>
    </div>
  )
}

// Ezek az oldalak nagy képernyőn a teljes szélességet használják
const WIDE_ROUTES = ['/beosztas-szerkeszto', '/terkep', '/attekintes', '/riportok', '/ber', '/kepek', '/naplo', '/fuvar-feltoltes']

export default function AppShell({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { pathname } = useLocation()
  const role = profile?.role
  const isCrew = isCrewRole(role)
  const isManagerOrAdmin = role === 'manager' || role === 'admin'

  const nav: NavItem[] = [{ to: '/', icon: '🏠', label: 'Kezdőlap', end: true }]
  if (isCrew) {
    nav.push({ to: '/beolvasas', icon: '📷', label: 'Beolvasás' })
    nav.push({ to: '/fuvar', icon: '🗺️', label: 'Fuvar' })
  }
  if (isManagerOrAdmin) {
    nav.push({ to: '/jovahagyas', icon: '✅', label: 'Jóváhagyás' })
    nav.push({ to: '/tagok', icon: '👥', label: 'Tagok' })
  }
  nav.push({ to: '/profil', icon: '👤', label: 'Profil' })

  return (
    <div className="app">
      <PullToRefresh />
      <PushPrompt />
      <header className="topbar">
        <div className="brand">
          <img src="/pwa-192.png" alt="" />
          <span>Alza</span>
        </div>
        <div className="spacer" />
        <SyncBadge />
        <WorkspaceSwitcher />
      </header>

      <main className={`content${WIDE_ROUTES.includes(pathname) ? ' wide' : ''}`}>{children}</main>

      <nav className="bottom-nav">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            <span className="ico">{n.icon}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

function SyncBadge() {
  const { count, failed, online } = useOutboxStatus()
  const [open, setOpen] = useState(false)
  if (failed > 0) {
    return (
      <>
        <button
          className="sync-badge queued"
          style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
          title="Szinkronizálási hiba — koppints a részletekért"
          onClick={() => setOpen(true)}
        >
          <span className="dot" />{failed} hiba
        </button>
        {open && <FailedPanel onClose={() => setOpen(false)} />}
      </>
    )
  }
  if (!online) return <span className="sync-badge offline"><span className="dot" />Offline</span>
  if (count > 0) return <span className="sync-badge queued"><span className="dot" />{count} vár</span>
  return null
}

// Parkolt (többször hibázott) tételek kezelése: újrapróbálás vagy eldobás
function FailedPanel({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<OutboxRecord[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => setItems(await listFailed())
  useEffect(() => { void load() }, [])

  const act = async (id: string, fn: (id: string) => Promise<void>) => {
    setBusy(id)
    try { await fn(id); await load() } finally { setBusy(null) }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div className="card stack" style={{ maxWidth: 460, width: '100%', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="between">
          <div className="card-title" style={{ margin: 0 }}>⚠️ Nem szinkronizált tételek</div>
          <button className="btn ghost sm" onClick={onClose}>✕</button>
        </div>
        {items.length === 0 && <p className="muted small">Nincs több hibás tétel. 🎉</p>}
        {items.map((r) => (
          <div key={r.id} className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div className="small" style={{ fontWeight: 700 }}>{r.label}</div>
            <div className="tiny muted">{new Date(r.createdAt).toLocaleString('hu-HU')}</div>
            {r.lastError && <div className="tiny" style={{ color: 'var(--danger)' }}>{r.lastError}</div>}
            <div className="btn-grid">
              <button className="btn sm" disabled={busy === r.id} onClick={() => void act(r.id, retryFailed)}>🔄 Újra</button>
              <ConfirmButton className="btn danger sm" confirmLabel="Végleg eldobom" disabled={busy === r.id} onConfirm={() => void act(r.id, discardFailed)}>
                🗑 Eldobás
              </ConfirmButton>
            </div>
          </div>
        ))}
        <p className="tiny muted" style={{ margin: 0 }}>
          Ezek a tételek többszöri próbálkozás után sem mentek fel. Az „Újra" új kört indít; az „Eldobás" végleg törli őket.
        </p>
      </div>
    </div>
  )
}
