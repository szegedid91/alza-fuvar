import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useRoutes } from '../hooks/useRoutes'
import { useMembers } from '../hooks/useMembers'
import { sendPush } from '../lib/push'
import { openWhatsApp } from '../lib/groupMessage'
import { todayISO, formatDate } from '../lib/labels'
import { toast } from '../lib/toast'
import { errMsg } from '../lib/errors'
import Icon from './Icon'

// Járat-elmaradás (vagy más napi közlemény) kihirdetése: a kiválasztott nap beosztott embereinek
// (sofőr, rakodó, betanuló) push megy az appból — nem kell a csoportban keresgélni, ki érintett.
export default function RouteCancelCard() {
  const { currentWorkspaceId } = useWorkspace()
  const { data: routes } = useRoutes()
  const { data: members } = useMembers()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(todayISO())
  const [routeId, setRouteId] = useState('')
  const [text, setText] = useState('')
  const nameOf = useMemo(() => Object.fromEntries((members ?? []).map((m) => [m.id, m.full_name || m.email || '—'])), [members])

  const { data: shifts } = useQuery({
    queryKey: ['shifts-day', currentWorkspaceId, date],
    enabled: open && !!currentWorkspaceId && /^\d{4}-\d{2}-\d{2}$/.test(date),
    queryFn: async () => {
      const { data, error } = await supabase.from('shifts').select('id, route_id, round, driver_id, loader_id, trainee_id').eq('workspace_id', currentWorkspaceId!).eq('work_date', date)
      if (error) throw error
      return data ?? []
    },
  })
  const targets = useMemo(() => {
    const ids = new Set<string>()
    for (const s of shifts ?? []) {
      if (routeId && s.route_id !== routeId) continue
      for (const u of [s.driver_id, s.loader_id, s.trainee_id]) if (u) ids.add(u)
    }
    return [...ids]
  }, [shifts, routeId])
  const routeCode = routes?.find((r) => r.id === routeId)?.code ?? null
  const defaultText = `A(z) ${formatDate(date)} ${routeCode ? `${routeCode} járat` : 'járat'} elmarad. Kérjük, ne indulj el — a részletekről a vezetőség tájékoztat.`

  const send = useMutation({
    mutationFn: async () => {
      const body = (text.trim() || defaultText).slice(0, 400)
      const sent = await sendPush(targets, 'Járat-közlemény', body, '/')
      return { sent, body }
    },
    onSuccess: ({ sent, body }) => {
      toast.success(`Push kiküldve ${targets.length} embernek (${sent} készülékre ért el). A csoportba is mehet ugyanez.`)
      openWhatsApp(body)
      setOpen(false); setText('')
    },
    onError: (e) => toast.error(errMsg(e, 'A küldés nem sikerült')),
  })

  if (!open) return (
    <button type="button" className="card between" style={{ textAlign: 'left', cursor: 'pointer', padding: 12, color: 'inherit', width: '100%' }} onClick={() => setOpen(true)}>
      <div className="card-title" style={{ margin: 0 }}><Icon name="ban" />Járat elmarad / közlemény</div>
      <span className="tiny muted row" style={{ gap: 4 }}>push a beosztottaknak <Icon name="chevron-right" size={14} /></span>
    </button>
  )
  return (
    <div className="card stack" style={{ gap: 8, borderColor: 'var(--warning)' }}>
      <div className="card-title" style={{ margin: 0 }}><Icon name="ban" />Járat elmarad / közlemény</div>
      <div className="grid-2">
        <div className="field"><label>Nap</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Járat</label>
          <select className="select" value={routeId} onChange={(e) => setRouteId(e.target.value)}>
            <option value="">minden járat</option>
            {(routes ?? []).map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label>Üzenet</label><textarea className="input" rows={3} value={text} placeholder={defaultText} onChange={(e) => setText(e.target.value)} /></div>
      <div className="tiny muted">
        Címzettek ({targets.length}): {targets.length ? targets.map((id) => nameOf[id] ?? '–').join(', ') : 'erre a napra nincs beosztás'}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn ghost sm" style={{ flex: 1 }} onClick={() => setOpen(false)}>Mégse</button>
        <button type="button" className="btn sm" style={{ flex: 2 }} disabled={targets.length === 0 || send.isPending} onClick={() => send.mutate()}><Icon name="send" size={14} />Push küldése{targets.length ? ` (${targets.length})` : ''}</button>
      </div>
      <div className="tiny muted">A push azoknak ér el, akik az appban engedélyezték az értesítést; küldés után a WhatsApp is megnyílik ugyanezzel a szöveggel a csoportnak.</div>
    </div>
  )
}
