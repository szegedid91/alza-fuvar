import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Tables } from '../lib/database.types'
import { useAuth } from './AuthContext'

export type Workspace = Tables<'workspaces'>

interface WorkspaceState {
  workspaces: Workspace[]        // az elérhető munkaterületek
  currentWorkspaceId: string | null
  currentWorkspace: Workspace | null
  setCurrentWorkspaceId: (id: string) => void
  loading: boolean
  reload: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceState | undefined>(undefined)
const STORAGE_KEY = 'alza-current-workspace'

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [currentWorkspaceId, setCurrentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Primitív függőségek: a profil-objektum minden auth-esemény után új referencia
  // (pl. óránkénti token-frissítés), és e nélkül feleslegesen újratöltenénk + villanna a loading.
  const profileId = profile?.id ?? null
  const profileStatus = profile?.status ?? null
  const profileWorkspaceId = profile?.workspace_id ?? null
  const hasLoadedRef = useRef(false)

  const load = useCallback(async () => {
    if (!profileId || profileStatus !== 'active') {
      setWorkspaces([])
      setCurrentId(null)
      setLoading(false)
      hasLoadedRef.current = false
      return
    }
    // a lista alkalmazása: az aktuális munkaterület a tároltból, különben a profilé / az első
    const apply = (list: Workspace[]) => {
      setWorkspaces(list)
      const stored = localStorage.getItem(STORAGE_KEY)
      const valid = stored && list.some((w) => w.id === stored) ? stored : null
      const fallback = profileWorkspaceId && list.some((w) => w.id === profileWorkspaceId)
        ? profileWorkspaceId
        : list[0]?.id ?? null
      setCurrentId(valid ?? fallback)
    }
    if (!hasLoadedRef.current) {
      // Gyors indulás: az utoljára ismert listával azonnal elindulnak a lekérdezések (a tárolt adatból rajzol az app),
      // a friss lista a háttérben érkezik — eddig minden lekérdezés erre a kérésre várt
      let seeded = false
      try {
        const raw = localStorage.getItem('alza-workspaces-cache')
        const cached = raw ? (JSON.parse(raw) as Workspace[]) : null
        if (Array.isArray(cached) && cached.length > 0) { apply(cached); hasLoadedRef.current = true; setLoading(false); seeded = true }
      } catch { /* sérült cache */ }
      if (!seeded) setLoading(true)
    }
    // Az RLS gondoskodik róla, hogy csak az elérhető workspace-ek jöjjenek vissza
    const { data, error } = await supabase.from('workspaces').select('*').order('name')
    let list = data ?? []
    if (error) {
      console.error('Munkaterületek betöltési hiba:', error.message)
      // Offline indulás: az utoljára ismert lista — enélkül a currentWorkspaceId
      // null lenne, és az összes offline cache-elt lekérdezés elérhetetlen maradna
      try {
        const raw = localStorage.getItem('alza-workspaces-cache')
        if (raw) list = JSON.parse(raw) as Workspace[]
      } catch { /* sérült cache */ }
    } else {
      try { localStorage.setItem('alza-workspaces-cache', JSON.stringify(list)) } catch { /* betelt tárhely */ }
    }
    apply(list)
    hasLoadedRef.current = true
    setLoading(false)
  }, [profileId, profileStatus, profileWorkspaceId])

  useEffect(() => { void load() }, [load])

  const setCurrentWorkspaceId = useCallback((id: string) => {
    setCurrentId(id)
    localStorage.setItem(STORAGE_KEY, id)
  }, [])

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId) ?? null

  return (
    <WorkspaceContext.Provider
      value={{ workspaces, currentWorkspaceId, currentWorkspace, setCurrentWorkspaceId, loading, reload: load }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace WorkspaceProvider-en belül használható')
  return ctx
}
