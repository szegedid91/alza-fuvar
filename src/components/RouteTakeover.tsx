import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday, todayIsBox } from '../hooks/useToday'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { errMsg } from '../lib/errors'
import { toast } from '../lib/toast'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

interface Candidate { route_id: string; code: string; round: number; car_id: string | null; plate: string | null; same_car: boolean; holder: string | null; current_index: number; total: number }
const REASONS = ['A kolléga nem tudja folytatni', 'Járatcsere', 'Autóhiba', 'Egyéb']

// Járat átvétele menet közben: a becsekkolt futár tovább viszi egy másik ember járatát onnan, ahol tart —
// akár ugyanazon az autón (a kolléga kiszállt), akár a saját autójával (járatcsere, autóhiba).
// A haladás a járaté: az átvevőnél ugyanaz a box következik, a vezetők értesítést kapnak.
export default function RouteTakeover() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const { data: today } = useToday()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState(REASONS[0])
  const [err, setErr] = useState<string | null>(null)
  const checkedIn = !!today?.checkin && !today.checkin.checked_out_at

  // a többiek beosztását a futár közvetlenül nem látja — a jelölteket a szerver adja
  useRealtimeInvalidate(checkedIn ? currentWorkspaceId : null, ['shifts', 'route_runs'], [['takeover']])
  const { data } = useQuery({
    queryKey: ['takeover', currentWorkspaceId, profile?.id, today?.checkin?.id],
    enabled: checkedIn && !!profile?.id,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('takeover_candidates')
      if (error) throw error
      return ((data as unknown as { routes?: Candidate[] } | null)?.routes ?? []) as Candidate[]
    },
  })

  const take = useMutation({
    mutationFn: async (c: Candidate) => {
      const { data, error } = await supabase.rpc('take_over_route', { p_route_id: c.route_id, p_round: c.round, p_reason: reason })
      if (error) throw error
      return data as unknown as { code: string; current_index: number; left: string | null }
    },
    onSuccess: async (r) => {
      setErr(null); setOpen(false)
      toast.success(`${r.code} járat átvéve — a(z) ${r.current_index + 1}. boxtól folytatod.`)
      await qc.invalidateQueries() // járat, haladás, jelzések, mai nap — minden innen függ
    },
    onError: (e) => setErr(errMsg(e, 'Az átvétel nem sikerült')),
  })

  if (!checkedIn) return null
  const list = data ?? []
  // ugyanazon az autón fut egy járat, amin nem vagyok rajta: ez a leggyakoribb eset (a kolléga kiszállt), kiemelve
  const here = list.filter((c) => c.same_car)
  const others = list.filter((c) => !c.same_car)
  // más járatát csak Box-napon ajánljuk fel (XL autóval nincs mit átvenni)
  const offerOthers = todayIsBox(today) && others.length > 0
  if (here.length === 0 && !offerOthers) return null
  const progress = (c: Candidate) => (c.total > 0 ? `${Math.min(c.current_index, c.total)} / ${c.total} box kész` : 'még nem indult')
  const row = (c: Candidate, primary: boolean) => (
    <div key={`${c.route_id}|${c.round}`} className="between" style={{ gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 800 }}>{c.code} járat</span><span className="muted"> · {c.round}. kör</span>
        <span className="tiny muted" style={{ display: 'block', overflowWrap: 'anywhere' }}>{c.holder ?? 'gazda nélkül'}{c.plate ? ` · ${c.plate}` : ''} · {progress(c)}</span>
      </span>
      <ConfirmButton className={`btn sm auto ${primary ? '' : 'secondary'}`} confirmLabel="Biztos? Átveszem" disabled={take.isPending} onConfirm={() => take.mutate(c)}>
        <Icon name="repeat" size={14} />Átveszem
      </ConfirmButton>
    </div>
  )
  const reasonPick = (
    <div className="field">
      <label htmlFor="takeover-reason">Miért veszed át?</label>
      <select id="takeover-reason" className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
        {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </div>
  )

  return (
    <>
      {here.length > 0 && (
        <div className="card stack" style={{ gap: 8, borderColor: 'var(--warning)' }}>
          <div className="card-title" style={{ margin: 0 }}><Icon name="repeat" style={{ color: 'var(--warning)' }} />Ezen az autón már fut egy járat</div>
          <div className="small">Ha te viszed tovább, vedd át: ugyanonnan folytatod, ahol a kolléga abbahagyta.</div>
          {reasonPick}
          {err && <div className="alert error">{err}</div>}
          {here.map((c) => row(c, true))}
        </div>
      )}
      {offerOthers && !open && (
        <button type="button" className="btn ghost sm" onClick={() => { setOpen(true); setErr(null) }}><Icon name="repeat" size={14} />Másik járat átvétele</button>
      )}
      {offerOthers && open && (
        <div className="card stack" style={{ gap: 8 }}>
          <div className="between">
            <div className="card-title" style={{ margin: 0 }}><Icon name="repeat" />Másik járat átvétele</div>
            <button type="button" className="link-btn tiny" style={{ padding: 0 }} onClick={() => setOpen(false)}>bezárás</button>
          </div>
          <div className="small">A kiválasztott járatot a mostani autóddal viszed tovább, onnan, ahol tart. Ha most másik járatod van folyamatban, az gazda nélkül marad, amíg valaki át nem veszi — a vezető értesítést kap.</div>
          {reasonPick}
          {err && here.length === 0 && <div className="alert error">{err}</div>}
          {others.map((c) => row(c, false))}
        </div>
      )}
    </>
  )
}
