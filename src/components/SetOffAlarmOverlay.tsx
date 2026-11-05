import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { activeAlarms, alarmPeople, normalizeDeadline, type SetOffAlarm } from '../lib/setoffAlerts'
import { startAlarm } from '../lib/alarmSound'
import { telHref } from '../lib/names'
import Icon from './Icon'

// Riasztó-képernyő a vezetőnek: ha egy hangos „nem indult el” szabály riasztást indított, az app
// megnyitásakor (vagy ha épp nyitva van) teljes képernyőn villog, csipog és rezeg, amíg le nem állítja.
// A megjelenés pillanatában jelezzük a szervernek, hogy látta — az értesítések ismétlése ekkor áll le.
export default function SetOffAlarmOverlay() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const key = useMemo(() => ['setoff-alarms', profile?.id], [profile?.id])

  const { data: rows } = useQuery({
    queryKey: key,
    enabled: !!profile?.id,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<SetOffAlarm[]> => {
      const { data, error } = await supabase.from('setoff_alarms').select('id, fired_at, deadline, missing, ended_reason')
        .is('dismissed_at', null).order('fired_at', { ascending: false }).limit(10)
      if (error) throw error
      return data ?? []
    },
  })
  const alarms = activeAlarms(rows ?? [])
  const active = alarms.length > 0
  const people = alarmPeople(alarms)

  // Azonnali frissítés: a push megérkezésekor (service worker üzen) és előtérbe kerüléskor
  useEffect(() => {
    const refetch = () => void qc.invalidateQueries({ queryKey: ['setoff-alarms'] })
    const onMsg = (e: MessageEvent) => { if ((e.data as { type?: string } | null)?.type === 'setoff-alarm') refetch() }
    const onVisible = () => { if (document.visibilityState === 'visible') refetch() }
    navigator.serviceWorker?.addEventListener('message', onMsg)
    document.addEventListener('visibilitychange', onVisible)
    return () => { navigator.serviceWorker?.removeEventListener('message', onMsg); document.removeEventListener('visibilitychange', onVisible) }
  }, [qc])

  // Megjelenéskor: a szerver ne küldje tovább az értesítést (látta), és indul a hang + rezgés
  const stopSound = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!active) return
    void supabase.rpc('setoff_alarms_seen').then(() => undefined, () => undefined)
    stopSound.current = startAlarm()
    return () => { stopSound.current?.(); stopSound.current = null }
  }, [active])

  // Telefonszámok a hívás-gombhoz (a vezető látja a munkaterülete tagjait)
  const ids = people.map((p) => p.id)
  const { data: phones } = useQuery({
    queryKey: ['setoff-alarm-phones', ids.join(',')],
    enabled: active && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('resolve_member_contacts', { ids })
      if (error) throw error
      return Object.fromEntries((data ?? []).map((r) => [r.id, r.phone as string | null]))
    },
  })

  async function dismiss(goTo?: string) {
    stopSound.current?.(); stopSound.current = null
    qc.setQueryData(key, [])
    try { await supabase.rpc('setoff_alarms_dismiss') } catch { /* a következő lekérdezés újra megmutatja */ }
    void qc.invalidateQueries({ queryKey: ['setoff-alarms'] })
    if (goTo) navigate(goTo)
  }

  if (!active) return null
  const deadline = normalizeDeadline(alarms[0].deadline)
  return (
    <div className="alarm-overlay" role="alertdialog" aria-modal="true" aria-labelledby="alarm-title">
      <div className="alarm-box">
        <div className="alarm-bell"><Icon name="bell" size={44} /></div>
        <h2 id="alarm-title">RIASZTÁS — nem indult el a munkába</h2>
        <p className="alarm-sub">
          {people.length > 0 ? `${people.length} fő` : 'Valaki'} {deadline ? `${deadline}-ig ` : ''}nem jelezte az indulást.
        </p>
        <div className="alarm-list">
          {people.map((p) => {
            const tel = telHref(phones?.[p.id] ?? null)
            return (
              <div key={p.id} className="alarm-person">
                <div style={{ minWidth: 0 }}>
                  <div className="alarm-name">{p.name}</div>
                  <div className="alarm-meta">{[p.plate, p.route ? `${p.route} járat` : null, p.round === 2 ? '2. kör' : null].filter(Boolean).join(' · ') || 'nincs autóhoz rendelve'}</div>
                </div>
                {tel
                  ? <a className="btn sm auto alarm-call" href={tel}><Icon name="phone" />Hívás</a>
                  : <span className="alarm-meta">nincs telefonszám</span>}
              </div>
            )
          })}
        </div>
        <button type="button" className="btn alarm-stop" onClick={() => void dismiss()}>
          <Icon name="check" />Láttam — riasztás leállítása
        </button>
        <button type="button" className="btn ghost sm alarm-open" onClick={() => void dismiss('/attekintes')}>
          Áttekintés megnyitása
        </button>
      </div>
    </div>
  )
}
