import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { clearOutbox } from '../lib/outbox'
import type { Tables } from '../lib/database.types'

export type Profile = Tables<'profiles'>

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

// Közös eszközön (depó-telefon) a következő belépő ne lássa az előző
// felhasználó gyorsítótárazott adatait, és ne játszódjanak le az ő nevében
// az előző felhasználó sorban maradt írásai.
async function clearLocalUserData(): Promise<void> {
  queryClient.clear()
  localStorage.removeItem('alza-query-cache')
  localStorage.removeItem('alza-current-workspace')
  localStorage.removeItem('alza-profile-cache')
  localStorage.removeItem('alza-workspaces-cache')
  try { await clearOutbox() } catch { /* IndexedDB hiba: nem blokkoló */ }
  // A service worker fotó-cache-e is felhasználói adat
  try { if ('caches' in window) await caches.delete('supabase-storage') } catch { /* n/a */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      console.error('Profil betöltési hiba:', error.message)
      // Offline indulás: az utoljára ismert saját profillal lépünk tovább,
      // különben a teljes offline cache elérhetetlen maradna
      try {
        const raw = localStorage.getItem('alza-profile-cache')
        if (raw) {
          const cached = JSON.parse(raw) as Profile
          if (cached.id === userId) { setProfile(cached); return }
        }
      } catch { /* sérült cache: figyelmen kívül */ }
      setProfile(null)
      return
    }
    if (data) {
      try { localStorage.setItem('alza-profile-cache', JSON.stringify(data)) } catch { /* betelt tárhely */ }
    }
    setProfile(data ?? null)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id)
  }, [session, loadProfile])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user) await loadProfile(data.session.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      // A callbackben tilos Supabase-hívást await-elni (auth-lock holtpont a
      // token-frissítésnél) — setTimeout-tal lépünk ki belőle. Azon belül
      // előbb a profil, aztán a session — így nincs olyan render-pillanat,
      // ahol session már van, de profil még nincs (hibaképernyő-villanás).
      setTimeout(() => {
        void (async () => {
          if (newSession?.user) {
            await loadProfile(newSession.user.id)
          } else {
            setProfile(null)
            // NEM CSAK a kézi kijelentkezésnél kell takarítani: lejárt/érvénytelenített
            // munkamenetnél is, különben közös eszközön az előző felhasználó
            // cache-e és sorban álló írásai a következőre maradnának.
            if (event === 'SIGNED_OUT') await clearLocalUserData()
          }
          setSession(newSession)
        })()
      }, 0)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
    await clearLocalUserData()
  }, [])

  return (
    <AuthContext.Provider value={{ session, profile, loading, refreshProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth AuthProvider-en belül használható')
  return ctx
}
