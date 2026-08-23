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
    if (!hasLoadedRef.current) setLoading(true)
    // Az RLS gondoskodik róla, hogy csak az elérhető workspace-ek jöjjenek vissza
    const { data, error } = await supabase.from('workspaces').select('*').order('name')
    if (error) console.error('Munkaterületek betöltési hiba:', error.message)
    const list = data ?? []
    setWorkspaces(list)

    const stored = localStorage.getItem(STORAGE_KEY)
    const valid = stored && list.some((w) => w.id === stored) ? stored : null
    const fallback = profileWorkspaceId && list.some((w) => w.id === profileWorkspaceId)
      ? profileWorkspaceId
      : list[0]?.id ?? null
    setCurrentId(valid ?? fallback)
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
