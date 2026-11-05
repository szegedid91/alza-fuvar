import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { isPushSubscribed, pushSupported } from '../lib/push'
import { ALERT_SCOPES, MAX_ALERT_RULES, normalizeDeadline, sortRules, nextNewRule, isDuplicateRule, callProblem, type AlertScope, type SetOffAlertRule, type CallStatus } from '../lib/setoffAlerts'
import { errMsg } from '../lib/errors'
import { toast } from '../lib/toast'
import ConfirmButton from './ConfirmButton'
import { SwitchRow } from './Switch'
import Icon from './Icon'

// Vezetői beállítás (manager / admin): riasztás, ha az aznapra beosztott munkatárs a megadott
// határidőig nem nyomta meg az „Elindultam a munkába” gombot. Mindenki a SAJÁT riasztásait
// állítja (ki/be, hangos/néma, határidő, kikre szóljon) — munkaterületenként.
export default function SetOffAlertsCard() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  // a határidő-mező helyi piszkozata (mentés a mező elhagyásakor, nem minden billentyűre)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    if (!pushSupported()) { setSubscribed(false); return }
    void Promise.race([isPushSubscribed(), new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]).then((v) => { if (alive) setSubscribed(v) })
    return () => { alive = false }
  }, [])

  const key = ['setoff-alerts', currentWorkspaceId, profile?.id]
  const { data: rules, isError, error: loadError } = useQuery({
    queryKey: key,
    enabled: !!currentWorkspaceId && !!profile?.id,
    queryFn: async (): Promise<SetOffAlertRule[]> => {
      const { data, error } = await supabase.from('setoff_alert_rules').select('id, deadline, scope, loud, enabled, call')
        .eq('workspace_id', currentWorkspaceId!).eq('user_id', profile!.id)
      if (error) throw error
      return sortRules((data ?? []).map((r) => ({ ...r, scope: r.scope as AlertScope })))
    },
  })
  const list = rules ?? []
  const fail = (e: unknown) => setError(/duplicate|23505/.test(errMsg(e, '')) ? 'Ilyen határidejű riasztás erre a körre már van.' : errMsg(e, 'A mentés nem sikerült'))
  const done = () => { setError(null); void qc.invalidateQueries({ queryKey: ['setoff-alerts'] }) }

  const add = useMutation({
    mutationFn: async () => {
      const n = nextNewRule(list)
      const { error } = await supabase.from('setoff_alert_rules').insert({ user_id: profile!.id, workspace_id: currentWorkspaceId!, deadline: n.deadline, scope: n.scope, loud: true, enabled: true })
      if (error) throw error
    },
    onSuccess: () => { done(); toast.success('Riasztás felvéve — állítsd be a határidőt.') },
    onError: fail,
  })
  const patch = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<Pick<SetOffAlertRule, 'deadline' | 'scope' | 'loud' | 'enabled' | 'call'>> }) => {
      const { error } = await supabase.from('setoff_alert_rules').update(values).eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('setoff_alert_rules').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
    onError: fail,
  })

  function saveDeadline(r: SetOffAlertRule) {
    const draft = drafts[r.id]
    if (draft === undefined) return
    const t = normalizeDeadline(draft)
    setDrafts((d) => { const { [r.id]: _drop, ...rest } = d; void _drop; return rest })
    if (!t) { setError('Érvénytelen időpont — óra:perc alakban add meg.'); return }
    if (t === normalizeDeadline(r.deadline)) return
    if (isDuplicateRule(list, r.id, t, r.scope)) { setError('Ilyen határidejű riasztás erre a körre már van.'); return }
    patch.mutate({ id: r.id, values: { deadline: t } })
  }
  function saveScope(r: SetOffAlertRule, scope: AlertScope) {
    if (isDuplicateRule(list, r.id, r.deadline, scope)) { setError('Ilyen határidejű riasztás erre a körre már van.'); return }
    patch.mutate({ id: r.id, values: { scope } })
  }

  // Telefonhívás: be van-e kötve a szolgáltató, és van-e hívható számom
  const anyCall = list.some((r) => r.call && r.loud)
  const { data: callStatus } = useQuery({
    queryKey: ['alarm-call-status', profile?.id],
    enabled: !!profile?.id,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CallStatus | null> => {
      const { data, error } = await supabase.functions.invoke('alarm-call', { body: { action: 'status' } })
      if (error) return null // a hívás állapota nem kritikus — a kártya enélkül is használható
      return data as CallStatus
    },
  })
  const [callMsg, setCallMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const testCall = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('alarm-call', { body: { action: 'test' } })
      if (error) {
        let msg = 'A próbahívás nem indult el.'
        try { msg = ((await (error as { context?: Response }).context?.json()) as { error?: string } | undefined)?.error ?? msg } catch { /* nem JSON válasz */ }
        throw new Error(msg)
      }
      return data as { phone?: string }
    },
    onSuccess: (d) => setCallMsg({ ok: true, text: `Próbahívás elindítva${d?.phone ? ` ide: ${d.phone}` : ''} — pár másodpercen belül csörög.` }),
    onError: (e) => setCallMsg({ ok: false, text: errMsg(e, 'A próbahívás nem indult el.') }),
  })
  const problem = callProblem(callStatus)

  const busy = add.isPending || patch.isPending || remove.isPending
  const anyOn = list.some((r) => r.enabled)

  return (
    <div className="card stack">
      <div className="card-title" style={{ margin: 0 }}><Icon name="clock" />Riasztás: nem indult el a munkába</div>
      <p className="tiny muted" style={{ margin: 0 }}>
        Ha az aznapra beosztott munkatárs a határidőig nem nyomja meg az „Elindultam a munkába” gombot (és be sem csekkolt),
        a határidő percében értesítést kapsz róla — így még van idő felhívni vagy helyettest szervezni.
        A beállítás csak a te értesítéseidre vonatkozik{currentWorkspace?.name ? `, a(z) ${currentWorkspace.name} munkaterületen` : ''}.
      </p>
      {isError && <div className="alert error">A riasztások nem tölthetők be: {errMsg(loadError, 'ismeretlen hiba')}</div>}
      {error && <div className="alert error">{error}</div>}
      {anyOn && subscribed === false && (
        <div className="alert info">Ezen az eszközön nincs bekapcsolva a push-értesítés — a riasztás csak olyan eszközre érkezik, ahol fent, az „Értesítések” kártyán bekapcsoltad.</div>
      )}

      {rules && list.length === 0 && <div className="tiny muted">Még nincs beállított riasztás.</div>}
      {list.map((r) => (
        <div key={r.id} className={`stack alert-rule ${r.enabled ? 'on' : 'off'}`}>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0, width: 120, flexShrink: 0 }}>
              <label>Határidő</label>
              <input className="input num" type="time" aria-label="Határidő" value={drafts[r.id] ?? normalizeDeadline(r.deadline) ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))} onBlur={() => saveDeadline(r)} />
            </div>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 0 }}>
              <label>Kikre szóljon</label>
              <select className="select" aria-label="Kikre szóljon" value={r.scope} disabled={busy} onChange={(e) => saveScope(r, e.target.value as AlertScope)}>
                {ALERT_SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <SwitchRow title="Riasztás" on={r.enabled} disabled={busy} onChange={(v) => patch.mutate({ id: r.id, values: { enabled: v } })}
            hint={r.enabled ? `naponta ${normalizeDeadline(r.deadline) ?? ''}-kor ellenőriz` : 'ez a szabály most nem szól'} />
          <div className="field" style={{ margin: 0 }}>
            <label>Hogyan szóljon</label>
            <div className="tabs" style={{ margin: 0 }}>
              <button type="button" className={r.loud ? 'active' : ''} aria-pressed={r.loud} disabled={busy} onClick={() => { if (!r.loud) patch.mutate({ id: r.id, values: { loud: true } }) }}><Icon name="bell" size={16} />Hangos riasztás</button>
              <button type="button" className={!r.loud ? 'active' : ''} aria-pressed={!r.loud} disabled={busy} onClick={() => { if (r.loud) patch.mutate({ id: r.id, values: { loud: false } }) }}><Icon name="moon" size={16} />Néma</button>
            </div>
          </div>
          {r.loud
            ? <SwitchRow title="Telefonhívás is" on={r.call} disabled={busy} onChange={(v) => patch.mutate({ id: r.id, values: { call: v } })}
                hint={r.call ? 'felhív, ha 1 percen belül nem nyitod meg' : 'csak értesítés jön, hívás nem'} />
            : <div className="tiny muted">Telefonhívás csak hangos riasztáshoz kérhető.</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <ConfirmButton className="btn ghost sm auto" confirmLabel="Biztos? Törlés" title="Riasztás törlése" disabled={busy} onConfirm={() => remove.mutate(r.id)}>
              <Icon name="trash" size={16} />Szabály törlése
            </ConfirmButton>
          </div>
        </div>
      ))}

      <button className="btn secondary sm" disabled={busy || !rules || list.length >= MAX_ALERT_RULES} onClick={() => add.mutate()}>
        <Icon name="plus" />Új riasztás
      </button>

      <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div className="small" style={{ fontWeight: 700 }}><Icon name="phone" size={15} style={{ verticalAlign: -2, marginRight: 4 }} />Telefonhívás</div>
        <p className="tiny muted" style={{ margin: 0 }}>
          Ha egy hangos riasztást 1 percen belül nem nyitsz meg, a rendszer fel is hív: felolvassa, kik hiányoznak, és az 1-es gombbal
          a hívásból is leállíthatod. Ha nem veszed fel, 5 percenként még kétszer próbálkozik. Mindig ugyanarról a számról hív —
          mentsd el névjegyként, és engedélyezd neki a „Ne zavarjanak” módon való átjutást.
        </p>
        {callStatus?.phone
          ? <div className="tiny muted">Hívott szám: <strong>{callStatus.phone}</strong> — fent, az „Adataim” résznél módosítható.</div>
          : <div className="tiny muted">A hívott szám a saját telefonszámod — fent, az „Adataim” résznél add meg (magyar mobilszám kell).</div>}
        {problem && (anyCall || !callStatus?.configured) && <div className="alert info" style={{ fontSize: 13 }}>{problem}</div>}
        {callMsg && <div className={`alert ${callMsg.ok ? 'success' : 'error'}`} style={{ fontSize: 13 }}>{callMsg.text}</div>}
        <button type="button" className="btn ghost sm" disabled={testCall.isPending || !callStatus?.configured || !callStatus?.phone} onClick={() => { setCallMsg(null); testCall.mutate() }}>
          <Icon name="phone" />{testCall.isPending ? 'Hívás indítása…' : 'Próbahívás a saját számomra'}
        </button>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        Több riasztás is felvehető (pl. 23:30 az éjszakai Box-körre, 05:00 a hajnalira). Az időpont budapesti idő; az adott naptári nap
        beosztását nézi. „Hangos”: riasztás — 20 másodpercenként újra szól (hang és rezgés), amíg meg nem nyitod az appot,
        legfeljebb 30 percig; az appban villogó, csipogó riasztó-képernyő fogad a hiányzók nevével és hívás-gombbal. Ha közben
        mindenki elindul, magától leáll. „Néma”: egyetlen értesítés hang és rezgés nélkül. A telefon ne legyen lenémítva vagy
        „Ne zavarjanak” módban — azt a riasztás nem tudja felülírni.
      </p>
    </div>
  )
}
