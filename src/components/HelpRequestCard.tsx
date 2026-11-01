import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { startHelpShare, useHelpShare } from '../lib/helpShare'
import { errMsg } from '../lib/errors'
import Icon from './Icon'

// „Elakadtam” — a futár innen kér élő segítséget: a vezető pusht kap, és látja a képernyőjét
export default function HelpRequestCard({ compact = false }: { compact?: boolean }) {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const s = useHelpShare()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (s.active) return null
  async function start() {
    if (!profile || !currentWorkspaceId) return
    setBusy(true); setErr(null)
    try { await startHelpShare(currentWorkspaceId, profile.id, note); setOpen(false); setNote('') }
    catch (e) { setErr(errMsg(e, 'Nem sikerült elindítani')) }
    finally { setBusy(false) }
  }
  if (!open) {
    return (
      <button type="button" className={`btn ghost ${compact ? 'sm' : ''}`} style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }} onClick={() => setOpen(true)}>
        <Icon name="life-buoy" />Elakadtam — segítséget kérek
      </button>
    )
  }
  return (
    <div className="card stack" style={{ borderColor: 'var(--warning)', gap: 8 }}>
      <div className="card-title" style={{ margin: 0 }}><Icon name="life-buoy" />Segítségkérés a vezetőtől</div>
      <p className="small muted" style={{ margin: 0 }}>A vezető értesítést kap, és amíg le nem állítod, <strong>látja, amit az appban látsz</strong> (az oldalt és a mezőket, a kamera képét nem). Rá tud mutatni, hova koppints, és üzenhet. Bármikor leállíthatod a felső sávon.</p>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Röviden: miben akadtál el? (nem kötelező)" maxLength={200} />
      {err && <div className="alert error">{err}</div>}
      <div className="btn-grid">
        <button type="button" className="btn secondary sm" disabled={busy} onClick={() => setOpen(false)}>Mégse</button>
        <button type="button" className="btn sm" disabled={busy} onClick={() => void start()}><Icon name="eye" size={16} />{busy ? 'Indítás…' : 'Indítás'}</button>
      </div>
    </div>
  )
}
