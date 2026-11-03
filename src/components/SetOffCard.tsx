import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { recordStatusEvent } from '../lib/statusEvents'
import { toast } from '../lib/toast'
import { errMsg } from '../lib/errors'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

// „Elindultam a munkába” — a nap legelső lépése, még becsekkolás előtt. A kezdőlapon
// ilyenkor CSAK ez látszik (fent a név, itt a mai autó és járat). Koppintásra a
// vezetők pusht kapnak (ki, melyik autóval és járattal indult el); a jelzés idő +
// GPS-szel rögzül, az Áttekintésben is látszik.
export default function SetOffCard({ setOffAt }: { setOffAt: string | null }) {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const { data: today, isLoading } = useToday()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const planned = today?.planned ?? null
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })

  async function setOff() {
    if (!currentWorkspaceId || !profile) return
    setBusy(true)
    try {
      await recordStatusEvent({ workspaceId: currentWorkspaceId, userId: profile.id, carId: null, kind: 'set_off', at: new Date(), geofence: currentWorkspace })
      toast.success('Jelezve a vezetőknek: elindultál. Jó utat!')
      await qc.invalidateQueries({ queryKey: ['status-events'] })
    } catch (e) {
      toast.error('Nem sikerült jelezni: ' + errMsg(e, 'ismeretlen hiba'))
    } finally {
      setBusy(false)
    }
  }

  if (setOffAt) {
    return (
      <div className="card" style={{ borderColor: 'var(--success)' }}>
        <div className="between">
          <span className="row" style={{ gap: 6 }}><Icon name="navigation" size={18} style={{ color: 'var(--success)' }} /><strong>Elindultál {hhmm(setOffAt)}</strong></span>
          {planned && <span className="num muted small">{planned.plate}{planned.routeCode ? ` · ${planned.routeCode}` : ''}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="card stack primary" style={{ gap: 12 }}>
      <div className="card-title" style={{ margin: 0 }}><Icon name="calendar" />Mai beosztás</div>
      {isLoading ? (
        <div className="muted small">Betöltés…</div>
      ) : planned ? (
        <div>
          <div className="num num-xl">{planned.plate}</div>
          <div className="small muted">
            {planned.label ? `${planned.label} · ` : ''}
            {planned.routeCode ? `${planned.routeCode} járat` : 'járat nincs megadva'}
            {planned.round === 2 ? ' · 2. kör' : ''}
            {today?.assignedRole === 'driver' ? ' · sofőr' : today?.assignedRole === 'loader' ? ' · rakodó' : today?.assignedRole === 'trainee' ? ' · betanuló' : ''}
          </div>
        </div>
      ) : (
        <div className="small muted">Ma nem vagy autóra beosztva — ha mégis dolgozol, a becsekkolásnál kézzel választhatsz autót.</div>
      )}
      <ConfirmButton className="btn" confirmLabel="Biztos? Elindultam" disabled={busy} onConfirm={() => void setOff()} style={{ minHeight: 56, fontSize: 17 }}>
        <Icon name="navigation" />{busy ? 'Jelzés…' : 'Elindultam a munkába'}
      </ConfirmButton>
      <div className="tiny muted">A vezetők értesítést kapnak, hogy elindultál. A becsekkolás (QR) ezután jön, a telephelyen.</div>
    </div>
  )
}
