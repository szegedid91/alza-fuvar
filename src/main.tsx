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

initTheme()
registerSW({ immediate: true })

// A query-cache localStorage-be mentése -> offline újratöltés után is elérhető a legutóbbi adat
// FONTOS: ha egy lekérdezés visszaadott adatszerkezete változik, a buster-t
// léptetni kell — különben a régi mentett cache összeakad az új kóddal.
const persister = createSyncStoragePersister({ storage: window.localStorage, key: 'alza-query-cache' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24, buster: 'v3' }}>
      <BrowserRouter>
        <AuthProvider>
          <WorkspaceProvider>
            <App />
          </WorkspaceProvider>
        </AuthProvider>
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
)
