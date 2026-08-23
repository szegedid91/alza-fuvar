import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
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
    if (error) console.error('Profil betöltési hiba:', error.message)
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

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
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
    // Közös eszközön (depó-telefon) a következő belépő ne lássa az előző
    // felhasználó gyorsítótárazott adatait — a memóriában lévő cache-t is
    // üríteni kell, különben a persister visszaírná a localStorage-be.
    queryClient.clear()
    localStorage.removeItem('alza-query-cache')
    localStorage.removeItem('alza-current-workspace')
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
