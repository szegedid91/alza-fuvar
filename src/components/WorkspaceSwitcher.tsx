import { useWorkspace } from '../context/WorkspaceContext'
import { useAuth } from '../context/AuthContext'

export default function WorkspaceSwitcher() {
  const { profile } = useAuth()
  const { workspaces, currentWorkspaceId, setCurrentWorkspaceId } = useWorkspace()

  // Sofőr / rakodó csak egy munkaterülethez tartozik -> csak megjelenítés
  const canSwitch = (profile?.role === 'manager' || profile?.role === 'admin') && workspaces.length > 1

  if (workspaces.length === 0) return null

  if (!canSwitch) {
    const name = workspaces.find((w) => w.id === currentWorkspaceId)?.name ?? workspaces[0]?.name
    return <span className="badge">{name}</span>
  }

  return (
    <select
      className="select"
      style={{ minHeight: 40, padding: '8px 12px', width: 'auto', maxWidth: 200, fontSize: 14, fontWeight: 700 }}
      value={currentWorkspaceId ?? ''}
      onChange={(e) => setCurrentWorkspaceId(e.target.value)}
      aria-label="Munkaterület váltása"
    >
      {workspaces.map((w) => (
        <option key={w.id} value={w.id}>{w.name}</option>
      ))}
    </select>
  )
}
