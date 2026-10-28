// ELSŐKÉNT: a jelszó-visszaállító link hash-ét még azelőtt elmentjük,
// hogy a Supabase-kliens kitakarítaná a címsorból
import './lib/recovery'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
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
import { setPendingUpdate } from './lib/swUpdate'
import ErrorBoundary from './components/ErrorBoundary'
import Toaster from './components/Toaster'
import UpdateBanner from './components/UpdateBanner'

initTheme()
installGlobalErrorHandlers()

// Új verzió: NEM töltünk újra magunktól (félbehagyott űrlap elveszne) —
// az UpdateBanner mutatja, és a felhasználó koppint a frissítésre.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { setPendingUpdate(updateSW) },
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
const persister = createSyncStoragePersister({ storage: window.localStorage, key: 'alza-query-cache' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24, buster: 'v5' }}>
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
