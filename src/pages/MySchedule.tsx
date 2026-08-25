import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { resolveNames } from '../lib/names'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { todayISO, formatDate, formatHuf, adjustmentTypeLabel, swapStatusLabel } from '../lib/labels'
import CarTimeline, { type TimelineEntry } from '../components/CarTimeline'
import type { Tables } from '../lib/database.types'

type SwapRequest = Tables<'swap_requests'>

const DAY_NAMES = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap']

// Helyi (Budapest) naptári nap ISO formában — nem UTC!
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function MySchedule() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const today = todayISO()

  // Heti nézet: 0 = aktuális hét, -1 = előző, +1 = következő
  const [weekOffset, setWeekOffset] = useState(0)
  const weekDays = (() => {
    const d = new Date()
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weekOffset * 7) // hétfő
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(d)
      x.setDate(d.getDate() + i)
      return localISO(x)
    })
  })()

  const { data: weekShifts } = useQuery({
    queryKey: ['my-week', currentWorkspaceId, profile?.id, weekDays[0]],
    enabled: !!currentWorkspaceId && !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shifts')
        .select('*, car:cars(plate,label,category:car_categories(name))')
        .eq('workspace_id', currentWorkspaceId!)
        .or(`driver_id.eq.${profile!.id},loader_id.eq.${profile!.id}`)
        .gte('work_date', weekDays[0])
        .lte('work_date', weekDays[6])
        .order('work_date')
      if (error) throw error
      const rows = data ?? []
      const names = await resolveNames(rows.flatMap((s) => [s.driver_id, s.loader_id]))
      return rows.map((s) => ({ ...s, _names: names }))
    },
  })

  const { data: shifts, isLoading } = useQuery({
    queryKey: ['my-shifts', currentWorkspaceId, profile?.id],
    enabled: !!currentWorkspaceId && !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shifts')
        .select('*, car:cars(plate,label)')
        .eq('workspace_id', currentWorkspaceId!)
        .or(`driver_id.eq.${profile!.id},loader_id.eq.${profile!.id}`)
        .gte('work_date', today)
        .order('work_date')
      if (error) throw error
      const rows = data ?? []
      const names = await resolveNames(rows.flatMap((s) => [s.driver_id, s.loader_id]))
      return rows.map((s) => ({ ...s, _names: names }))
    },
  })

  // Cserekérések a saját beosztásokhoz
  const { data: swaps } = useQuery({
    queryKey: ['my-swaps', currentWorkspaceId, profile?.id],
    enabled: !!currentWorkspaceId && !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('swap_requests')
        .select('*')
        .eq('workspace_id', currentWorkspaceId!)
        .or(`requested_by.eq.${profile!.id},partner_id.eq.${profile!.id}`)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data ?? []) as SwapRequest[]
    },
  })

  const [actionError, setActionError] = useState<string | null>(null)

  // Mai autóhasználat idővonala (napközbeni autócserékkel)
  const { data: myTimeline } = useQuery<TimelineEntry[]>({
    queryKey: ['my-car-timeline', currentWorkspaceId, profile?.id, today],
    enabled: !!currentWorkspaceId && !!profile,
    queryFn: async () => {
      const { data } = await supabase.from('check_ins')
        .select('checked_in_at, checked_out_at, switch_reason, car:cars!check_ins_car_id_fkey(plate)')
        .eq('workspace_id', currentWorkspaceId!)
        .eq('user_id', profile!.id)
        .eq('work_date', today)
        .order('checked_in_at')
      return (data ?? []).map((r) => ({
        plate: (r.car as unknown as { plate: string } | null)?.plate ?? '?',
        from: r.checked_in_at,
        to: r.checked_out_at,
        reason: r.switch_reason,
      }))
    },
  })

  // 30 perces cserekérés-korlát: a legutóbbi saját kérésünk óta hátralévő idő.
  // A szerver (DB-trigger) is kikényszeríti, itt csak a gombot tiltjuk le hozzá.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const myLastRequestAt = (swaps ?? [])
    .filter((r) => r.requested_by === profile?.id)
    .reduce<string | null>((m, r) => (!m || r.created_at > m ? r.created_at : m), null)
  const cooldownLeftMin = myLastRequestAt
    ? Math.max(0, Math.ceil((new Date(myLastRequestAt).getTime() + 30 * 60 * 1000 - nowTick) / 60_000))
    : 0

  const requestSwap = useMutation({
    mutationFn: async ({ shiftId, partnerId, workspaceId }: { shiftId: string; partnerId: string | null; workspaceId: string }) => {
      const { error } = await supabase.from('swap_requests').insert({
        workspace_id: workspaceId, // a shift munkaterülete (több-workspace-es usernél eltérhet az aktívtól)
        shift_id: shiftId,
        requested_by: profile!.id,
        partner_id: partnerId, // a társnak is jóvá kell hagynia (a menedzser felülbírálhat)
        note: 'Sofőr ↔ rakodó csere',
      })
      if (error) throw error
    },
    onSuccess: () => { setActionError(null); setNowTick(Date.now()); void qc.invalidateQueries({ queryKey: ['my-swaps'] }) },
    onError: (e) => setActionError(e instanceof Error ? `A cserekérés nem sikerült: ${e.message}` : 'A cserekérés nem sikerült'),
  })

  // A társ döntése egy hozzá beérkező cserekérésről
  const partnerDecide = useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      const { error } = await supabase.rpc('partner_decide_swap', { p_request_id: id, p_accept: accept })
      if (error) throw error
    },
    onSuccess: () => { setActionError(null); void qc.invalidateQueries({ queryKey: ['my-swaps'] }) },
    onError: (e) => setActionError(e instanceof Error ? `A döntés mentése nem sikerült: ${e.message}` : 'A döntés mentése nem sikerült'),
  })

  // Hozzám beérkező, döntésre váró cserekérések (én vagyok a társ)
  const incoming = (swaps ?? []).filter(
    (r) => r.partner_id === profile?.id && r.status === 'pending' && r.partner_decision === 'pending',
  )

  const { data: todayAdj } = useQuery({
    queryKey: ['my-adj-today', currentWorkspaceId, profile?.id, today],
    enabled: !!currentWorkspaceId && !!profile,
    queryFn: async () => {
      const { data } = await supabase.from('adjustments').select('*')
        .eq('workspace_id', currentWorkspaceId!)
        .eq('user_id', profile!.id).eq('work_date', today).order('created_at')
      return data ?? []
    },
  })

  const advances = (todayAdj ?? []).filter((a) => a.type === 'advance').reduce((s, a) => s + Number(a.amount), 0)
  const deductions = (todayAdj ?? []).filter((a) => a.type === 'deduction').reduce((s, a) => s + Number(a.amount), 0)

  // Név-térkép a bejövő kérések kiírásához (a shifts lekérdezés _names-éből)
  const anyNames = (shifts?.[0]?._names ?? {}) as Record<string, string>

  return (
    <div className="stack">
      <h2>Beosztásom</h2>

      {actionError && <div className="alert error">{actionError}</div>}

      {incoming.length > 0 && (
        <div className="card stack" style={{ borderColor: 'var(--warning)' }}>
          <div className="card-title">🔄 Cserekérés vár a döntésedre</div>
          {incoming.map((r) => {
            const sh = shifts?.find((s) => s.id === r.shift_id)
            return (
              <div key={r.id} className="stack" style={{ gap: 6 }}>
                <div className="small">
                  <strong>{anyNames[r.requested_by] ?? 'Egy munkatárs'}</strong> cserélne veled
                  {sh ? ` (${formatDate(sh.work_date)} — sofőr ↔ rakodó)` : ' (sofőr ↔ rakodó)'}.
                </div>
                <div className="btn-grid">
                  <button className="btn danger sm" disabled={partnerDecide.isPending}
                    onClick={() => partnerDecide.mutate({ id: r.id, accept: false })}>Elutasítom</button>
                  <button className="btn sm" disabled={partnerDecide.isPending}
                    onClick={() => partnerDecide.mutate({ id: r.id, accept: true })}>Elfogadom</button>
                </div>
              </div>
            )
          })}
          <p className="tiny muted" style={{ margin: 0 }}>A végső szót a menedzser mondja ki.</p>
        </div>
      )}

      <div className="card stack" style={{ gap: 8 }}>
        <div className="between">
          <div className="card-title" style={{ marginBottom: 0 }}>📆 Heti nézet</div>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <button className="btn ghost sm" onClick={() => setWeekOffset((o) => o - 1)} aria-label="Előző hét">‹</button>
            {weekOffset !== 0 && (
              <button className="btn ghost sm" onClick={() => setWeekOffset(0)}>Ma</button>
            )}
            <button className="btn ghost sm" onClick={() => setWeekOffset((o) => o + 1)} aria-label="Következő hét">›</button>
          </div>
        </div>
        <div className="tiny muted">{formatDate(weekDays[0])} – {formatDate(weekDays[6])}</div>
        <div className="stack" style={{ gap: 0 }}>
          {weekDays.map((dISO, i) => {
            const sh = (weekShifts ?? []).find((s) => s.work_date === dISO)
            const isToday = dISO === today
            const car = sh?.car as unknown as { plate: string; label: string | null; category: { name: string } | null } | null
            const names = (sh?._names ?? {}) as Record<string, string>
            const iAmDriver = sh?.driver_id === profile?.id
            const partnerId = sh ? (iAmDriver ? sh.loader_id : sh.driver_id) : null
            return (
              <div
                key={dISO}
                className="between"
                style={{
                  padding: '6px 8px',
                  borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                  borderRadius: isToday ? 8 : 0,
                  background: isToday ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'transparent',
                  opacity: sh ? 1 : 0.55,
                }}
              >
                <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                  <span className="small" style={{ fontWeight: isToday ? 800 : 600, minWidth: 78 }}>
                    {DAY_NAMES[i]}{isToday ? ' · ma' : ''}
                  </span>
                  {sh ? (
                    <span className="small">
                      {car?.category?.name ? `${car.category.name} · ` : ''}{car?.plate ?? '–'}
                      {partnerId && names[partnerId] ? <span className="muted"> · {names[partnerId]}</span> : null}
                    </span>
                  ) : (
                    <span className="small muted">Szabadnap</span>
                  )}
                </div>
                {sh && <span className="badge primary">{iAmDriver ? 'Sofőr' : 'Rakodó'}</span>}
              </div>
            )
          })}
        </div>
        <div className="tiny muted" style={{ textAlign: 'right' }}>
          Ezen a héten: {(weekShifts ?? []).length} nap
        </div>
      </div>

      <div className="card">
        <div className="card-title">Mai előleg / levonás</div>
        <div className="grid-2">
          <div className="between"><span className="muted small">Előleg</span><span className="badge warning">{formatHuf(advances)}</span></div>
          <div className="between"><span className="muted small">Levonás</span><span className="badge danger">{formatHuf(deductions)}</span></div>
        </div>
        {(todayAdj?.length ?? 0) > 0 && (
          <div className="list" style={{ marginTop: 10 }}>
            {todayAdj!.map((a) => (
              <div key={a.id} className="between">
                <span className="small">{adjustmentTypeLabel[a.type]}{a.reason ? ` · ${a.reason}` : ''}</span>
                <span className="small">{formatHuf(Number(a.amount))}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {isLoading && <div className="card"><div className="spinner" /></div>}
      {!isLoading && (shifts?.length ?? 0) === 0 && (
        <div className="empty"><span className="ico">📅</span>Nincs közelgő beosztásod.</div>
      )}

      {((myTimeline?.length ?? 0) > 1 || myTimeline?.some((e) => e.reason)) && (
        <div className="card stack">
          <div className="card-title">🕓 Mai autóhasználat</div>
          <CarTimeline entries={myTimeline!} />
        </div>
      )}

      {shifts?.map((s) => {
        const car = s.car as unknown as { plate: string; label: string | null } | null
        const names = (s._names ?? {}) as Record<string, string>
        const iAmDriver = s.driver_id === profile?.id
        const partnerId = iAmDriver ? s.loader_id : s.driver_id
        const partner = partnerId ? names[partnerId] : null
        const myRole = iAmDriver ? 'Sofőr' : 'Rakodó'
        // Legutóbbi cserekérés ehhez a shifthez
        const swap = (swaps ?? []).find((r) => r.shift_id === s.id)
        return (
          <div key={s.id} className="card stack">
            <div className="between">
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{formatDate(s.work_date)}</div>
                <div className="muted small">{car?.plate ?? '–'}{car?.label ? ` · ${car.label}` : ''}</div>
              </div>
              <span className="badge primary">{myRole}</span>
            </div>
            <div className="between">
              <span className="muted small">Társ</span>
              <span className="small">{partner || 'Nincs megadva'}</span>
            </div>
            {partnerId && s.work_date !== today && (
              <span className="tiny muted">🔄 Cserét csak aznap lehet kérni.</span>
            )}
            {partnerId && s.work_date === today && (
              swap && swap.status === 'pending' ? (
                <div className="stack" style={{ gap: 4 }}>
                  <span className="badge warning" style={{ width: 'fit-content' }}>🔄 Csere: {swapStatusLabel[swap.status]}</span>
                  <span className="tiny muted">
                    Társ ({partner ?? '?'}):{' '}
                    {swap.partner_decision === 'approved' ? '✔ elfogadta'
                      : swap.partner_decision === 'rejected' ? '✖ elutasította'
                      : 'még nem döntött'} · a menedzser hagyja jóvá
                  </span>
                </div>
              ) : (
                <>
                  {swap && <span className="tiny muted">Legutóbbi csere: {swapStatusLabel[swap.status]}</span>}
                  <button
                    className="btn ghost sm"
                    disabled={requestSwap.isPending || cooldownLeftMin > 0}
                    onClick={() => requestSwap.mutate({ shiftId: s.id, partnerId, workspaceId: s.workspace_id })}
                  >
                    {cooldownLeftMin > 0
                      ? `⏳ Új csere kérése ${cooldownLeftMin} perc múlva lehetséges`
                      : '🔄 Csere kérése (sofőr ↔ rakodó)'}
                  </button>
                </>
              )
            )}
          </div>
        )
      })}
      <p className="tiny muted" style={{ textAlign: 'center' }}>
        A cserét a menedzser hagyja jóvá — akár aznap is. Jóváhagyás után a szereped automatikusan frissül.
      </p>
    </div>
  )
}
