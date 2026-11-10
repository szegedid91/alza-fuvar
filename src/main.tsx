// ELSŐKÉNT: a jelszó-visszaállító link hash-ét még azelőtt elmentjük,
// hogy a Supabase-kliens kitakarítaná a címsorból
import './lib/recovery'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { WorkspaceProvider } from './context/WorkspaceContext'
import { queryClient } from './lib/queryClient'
import { initTheme } from './lib/theme'
import { installGlobalErrorHandlers } from './lib/errorReport'
import { setPendingUpdate, forceUpdate, startVersionWatch, healBrokenPrecache } from './lib/swUpdate'
import ErrorBoundary from './components/ErrorBoundary'
import Toaster from './components/Toaster'
import UpdateBanner from './components/UpdateBanner'

initTheme()
installGlobalErrorHandlers()

// Új verzió: NEM töltünk újra magunktól (félbehagyott űrlap elveszne) —
// az UpdateBanner mutatja, és a felhasználó koppint a frissítésre.
registerSW({
  immediate: true,
  // Új SW vár: ha a futó oldal MÁR a legújabb build (pl. kényszerített újratöltés után),
  // csendben aktiváljuk, sáv nélkül; különben sáv, és koppintásra workbox-os út +
  // biztonsági újratöltés (ha a SW nem venné át az oldalt)
  onNeedRefresh() {
    void (async () => {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
        const j = r.ok ? ((await r.json()) as { build?: string }) : null
        if (j?.build === __BUILD_TIME__) {
          const reg = await navigator.serviceWorker.getRegistration()
          reg?.waiting?.postMessage({ type: 'SKIP_WAITING' })
          return
        }
      } catch { /* nem tudjuk — marad a sáv */ }
      setPendingUpdate(() => forceUpdate())
    })()
  },
  // Új verzió keresése: 5 percenként, és amikor az app előtérbe kerül —
  // a nyitva hagyott app sem marad napokig a régi verzión
  onRegisteredSW(_url, reg) {
    if (!reg) return
    const check = () => { if (navigator.onLine) void reg.update().catch(() => undefined) }
    setInterval(check, 5 * 60_000)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
  },
})

// A query-cache localStorage-be mentése -> offline újratöltés után is elérhető a legutóbbi adat
// FONTOS: ha egy lekérdezés visszaadott adatszerkezete változik, a buster-t
// léptetni kell — különben a régi mentett cache összeakad az új kóddal.
// Verzió-figyelő (SW-től független) — a telefon ne ragadjon a régi buildnél
startVersionWatch(__BUILD_TIME__)
// Sérült előtöltött gyorsítótár (hiányzó kezdőlap) helyreállítása — különben offline nem indulna az app
void healBrokenPrecache()

// Előtérbe kerüléskor minden aktív lekérdezés frissül: a háttérben alvó app
// (telefon) nem kapta meg a realtime eseményeket — ne kelljen kézzel újratölteni
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && navigator.onLine) void queryClient.invalidateQueries({ refetchType: 'active' })
})

const persister = createSyncStoragePersister({ storage: window.localStorage, key: 'alza-query-cache' })
// SEC-16: a képernyő-pillanatképek (help-session, akár 900 KB), az audit-napló (bér, telefon),
// a hibajelentések és a bér NEM kerülnek a localStorage-be — közös telefonon ne maradjanak ott,
// és egy nagy tétel ne lépje túl a kvótát (akkor a teljes offline cache elveszne)
const NO_PERSIST = ['help-session', 'audit', 'client-errors', 'payroll', 'rate-history', 'feedback']
const shouldDehydrateQuery = (q: { queryKey: readonly unknown[]; state: { status: string } }) =>
  q.state.status === 'success' && !NO_PERSIST.some((k) => String(q.queryKey[0]).startsWith(k))

// A gyorsítótár-buster a build ideje: új buildnél a régi (más alakú) tárolt lekérdezések nem élnek tovább
// (a 2026-11-06-i „a is not iterable” az Előleg oldalon egy régi alakú tárolt válaszból jött)
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24, buster: __BUILD_TIME__, dehydrateOptions: { shouldDehydrateQuery } }}>
        <BrowserRouter>
          <AuthProvider>
            <WorkspaceProvider>
              <UpdateBanner />
              <App />
              <Toaster />
            </WorkspaceProvider>
          </AuthProvider>
        </BrowserRouter>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
