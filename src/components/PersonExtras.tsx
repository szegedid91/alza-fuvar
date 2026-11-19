import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { resolveNames } from '../lib/names'
import { formatDate, formatHuf, todayISO } from '../lib/labels'
import { errMsg } from '../lib/errors'
import ConfirmButton from './ConfirmButton'
import Icon, { type IconName } from './Icon'

const NOTE_KIND: Record<string, { label: string; badge: string }> = {
  note: { label: 'Megjegyzés', badge: '' }, praise: { label: 'Dicséret', badge: 'success' },
  warning: { label: 'Figyelmeztetés', badge: 'warning' }, complaint: { label: 'Megbízói panasz', badge: 'danger' },
}
const ABSENCE_KIND: Record<string, string> = { leave: 'Szabadság', sick: 'Betegség', other: 'Egyéb távollét' }

// Vezetői jegyzetek (megjegyzés, dicséret, figyelmeztetés, megbízói panasz) és távollétek egy emberhez.
// Csak a vezetők látják. A távollét napjai nem számítanak kimaradt napnak.
export function PersonRecords({ userId, workspaceId }: { userId: string; workspaceId: string | null }) {
  const qc = useQueryClient()
  const [err, setErr] = useState<string | null>(null)
  const [kind, setKind] = useState('note')
  const [date, setDate] = useState(todayISO())
  const [text, setText] = useState('')
  const [aKind, setAKind] = useState('leave')
  const [from, setFrom] = useState(todayISO())
  const [to, setTo] = useState(todayISO())
  const [aNote, setANote] = useState('')

  const { data } = useQuery({
    queryKey: ['person-records', userId],
    queryFn: async () => {
      const [n, a] = await Promise.all([
        supabase.from('person_notes').select('id, kind, note_date, text, created_by').eq('user_id', userId).order('note_date', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('absences').select('id, kind, from_date, to_date, note').eq('user_id', userId).order('from_date', { ascending: false }),
      ])
      if (n.error) throw n.error
      if (a.error) throw a.error
      const names = await resolveNames((n.data ?? []).map((x) => x.created_by))
      return { notes: n.data ?? [], absences: a.data ?? [], names }
    },
  })
  const done = async () => {
    setErr(null)
    await qc.invalidateQueries({ queryKey: ['person-records', userId] })
    await qc.invalidateQueries({ queryKey: ['person'] })
    await qc.invalidateQueries({ queryKey: ['people-list'] })
  }
  const fail = (e: unknown) => setErr(errMsg(e, 'A mentés nem sikerült'))
  const addNote = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error('A munkatárs nincs munkaterülethez rendelve.')
      const { error } = await supabase.from('person_notes').insert({ workspace_id: workspaceId, user_id: userId, kind, note_date: date, text: text.trim() })
      if (error) throw error
    },
    onSuccess: async () => { setText(''); await done() }, onError: fail,
  })
  const addAbsence = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error('A munkatárs nincs munkaterülethez rendelve.')
      if (to < from) throw new Error('A távollét vége nem lehet a kezdete előtt.')
      const { error } = await supabase.from('absences').insert({ workspace_id: workspaceId, user_id: userId, kind: aKind, from_date: from, to_date: to, note: aNote.trim() || null })
      if (error) throw error
    },
    onSuccess: async () => { setANote(''); await done() }, onError: fail,
  })
  const remove = useMutation({
    mutationFn: async ({ table, id }: { table: 'person_notes' | 'absences'; id: string }) => {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: done, onError: fail,
  })
  const days = (a: { from_date: string; to_date: string }) => Math.round((new Date(a.to_date).getTime() - new Date(a.from_date).getTime()) / 86_400_000) + 1

  return (
    <>
      {err && <div className="alert error">{err}</div>}
      <div className="card stack" style={{ gap: 8 }}>
        <div className="between">
          <div className="card-title" style={{ margin: 0 }}><Icon name="file-text" />Jegyzetek és visszajelzések</div>
          <span className={`badge ${data?.notes.length ? 'primary' : ''}`}>{data?.notes.length ?? 0}</span>
        </div>
        <div className="tiny muted">Megjegyzés, dicséret, figyelmeztetés vagy a megbízótól kapott panasz — dátummal, hogy legyen nyoma. Csak a vezetők látják.</div>
        <div className="grid-2">
          <div className="field"><label>Típus</label>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(NOTE_KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </div>
          <div className="field"><label>Dátum</label><input className="input" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <textarea className="input" rows={2} value={text} maxLength={2000} placeholder="Mi történt, miről beszéltetek?" onChange={(e) => setText(e.target.value)} style={{ resize: 'vertical' }} />
        <button type="button" className="btn sm" disabled={addNote.isPending || !text.trim() || !date} onClick={() => addNote.mutate()}>{addNote.isPending ? 'Mentés…' : 'Jegyzet mentése'}</button>
        {(data?.notes ?? []).map((n, i) => (
          <div key={n.id} className="between small" style={{ gap: 8, alignItems: 'flex-start', padding: '6px 0', borderTop: i === 0 ? '1px solid var(--border)' : '1px solid var(--border)' }}>
            <span style={{ minWidth: 0 }}>
              <span className={`badge ${NOTE_KIND[n.kind]?.badge ?? ''}`} style={{ marginRight: 6 }}>{NOTE_KIND[n.kind]?.label ?? n.kind}</span>
              <strong>{formatDate(n.note_date)}</strong>{n.created_by && data?.names[n.created_by] ? <span className="muted"> · {data.names[n.created_by]}</span> : null}
              <span style={{ display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 2 }}>{n.text}</span>
            </span>
            <ConfirmButton className="btn ghost sm auto" confirmLabel="Törlés" disabled={remove.isPending} aria-label="Jegyzet törlése"
              onConfirm={() => remove.mutate({ table: 'person_notes', id: n.id })}><Icon name="trash" size={16} /></ConfirmButton>
          </div>
        ))}
      </div>

      <div className="card stack" style={{ gap: 8 }}>
        <div className="between">
          <div className="card-title" style={{ margin: 0 }}><Icon name="calendar" />Távollétek</div>
          <span className={`badge ${data?.absences.length ? 'primary' : ''}`}>{data?.absences.length ?? 0}</span>
        </div>
        <div className="tiny muted">Szabadság, betegség: ezek a napok nem számítanak kimaradt napnak, akkor sem, ha be volt osztva.</div>
        <div className="grid-2">
          <div className="field"><label>Típus</label>
            <select className="select" value={aKind} onChange={(e) => setAKind(e.target.value)}>{Object.entries(ABSENCE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <div className="field"><label>Megjegyzés (nem kötelező)</label><input className="input" value={aNote} maxLength={500} onChange={(e) => setANote(e.target.value)} /></div>
          <div className="field"><label>Első nap</label><input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value) }} /></div>
          <div className="field"><label>Utolsó nap</label><input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <button type="button" className="btn sm" disabled={addAbsence.isPending || !from || !to} onClick={() => addAbsence.mutate()}>{addAbsence.isPending ? 'Mentés…' : 'Távollét mentése'}</button>
        {(data?.absences ?? []).map((a) => (
          <div key={a.id} className="between small" style={{ gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
            <span><strong>{ABSENCE_KIND[a.kind] ?? a.kind}</strong> <span className="muted">· {formatDate(a.from_date)}{a.to_date !== a.from_date ? ` – ${formatDate(a.to_date)}` : ''} · {days(a)} nap{a.note ? ` · ${a.note}` : ''}</span></span>
            <ConfirmButton className="btn ghost sm auto" confirmLabel="Törlés" disabled={remove.isPending} aria-label="Távollét törlése"
              onConfirm={() => remove.mutate({ table: 'absences', id: a.id })}><Icon name="trash" size={16} /></ConfirmButton>
          </div>
        ))}
      </div>
    </>
  )
}

const EVENT_LABEL: Record<string, { label: string; icon: IconName }> = {
  set_off: { label: 'Elindult otthonról', icon: 'log-out' }, arrived: { label: 'Megérkezett', icon: 'map-pin' }, departed: { label: 'Kiindult', icon: 'truck' },
  done: { label: 'Járat kész', icon: 'check-circle' }, settled: { label: 'Elszámolt', icon: 'banknote' },
}
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })

// Egy nap idővonala: minden, amit az ember aznap az alkalmazásban csinált, idő szerint
export function DayTimeline({ userId, dates }: { userId: string; dates: string[] }) {
  const [date, setDate] = useState(dates[0] ?? '')
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['person', 'day', userId, date],
    enabled: !!date,
    queryFn: async () => {
      const [ev, ci, logs, insp, clean, fuel, inc, hand] = await Promise.all([
        supabase.from('status_events').select('kind, at, note').eq('user_id', userId).eq('work_date', date),
        supabase.from('check_ins').select('first_checked_in_at, checked_in_at, checked_out_at, manual_checkin, switch_reason, prev_car_id, car:cars!check_ins_car_id_fkey(plate)').eq('user_id', userId).eq('work_date', date),
        supabase.from('route_stop_logs').select('done_at, late_minutes, delay_reason, round, box:alza_boxes(code)').eq('user_id', userId).eq('work_date', date),
        supabase.from('car_inspections').select('created_at, completed_at').eq('user_id', userId).eq('work_date', date),
        supabase.from('cleanings').select('created_at').eq('user_id', userId).eq('work_date', date),
        supabase.from('fuel_logs').select('created_at, amount, liters').eq('user_id', userId).eq('work_date', date),
        supabase.from('incidents').select('created_at, note').eq('user_id', userId).eq('work_date', date),
        // járat-átvételek, amelyekben érintett (átvette vagy tőle vették át)
        supabase.from('route_handovers').select('created_at, from_user, to_user, round, stop_index, reason, route:route_names(code)').eq('work_date', date).or(`to_user.eq.${userId},from_user.eq.${userId}`),
      ])
      for (const q of [ev, ci, logs, insp, clean, fuel, inc, hand]) if (q.error) throw q.error
      const items: { at: string; icon: IconName; text: string; warn?: boolean }[] = []
      for (const e of ev.data ?? []) items.push({ at: e.at, icon: EVENT_LABEL[e.kind]?.icon ?? 'circle-dot', text: `${EVENT_LABEL[e.kind]?.label ?? e.kind}${e.note ? ` — ${e.note}` : ''}` })
      for (const c of ci.data ?? []) {
        const plate = (c.car as unknown as { plate: string } | null)?.plate ?? '?'
        items.push({ at: c.checked_in_at, icon: 'qr-code', text: `${c.prev_car_id ? 'Autót váltott' : 'Becsekkolt'}: ${plate}${c.manual_checkin ? ' (kézzel, QR nélkül)' : ''}${c.switch_reason ? ` — ${c.switch_reason}` : ''}`, warn: !!c.manual_checkin })
        if (c.checked_out_at) items.push({ at: c.checked_out_at, icon: 'flag', text: `Lerakta az autót: ${plate}` })
      }
      for (const l of logs.data ?? []) if (l.done_at) {
        const late = Number(l.late_minutes ?? 0)
        items.push({ at: l.done_at, icon: 'package', text: `Box kész: ${(l.box as unknown as { code: string | null } | null)?.code ?? '?'} (${l.round ?? 1}. kör)${late > 0 ? ` — ${late} perc késés${l.delay_reason ? `: ${l.delay_reason}` : ''}` : ''}`, warn: late > 0 })
      }
      for (const i of insp.data ?? []) items.push({ at: i.completed_at ?? i.created_at, icon: 'camera', text: i.completed_at ? 'Autó-ellenőrzés kész (5 fotó)' : 'Autó-ellenőrzés elkezdve' })
      for (const c of clean.data ?? []) items.push({ at: c.created_at, icon: 'sparkles', text: 'Takarítás rögzítve' })
      for (const f of fuel.data ?? []) items.push({ at: f.created_at, icon: 'fuel', text: `Tankolás${f.liters ? `: ${Number(f.liters).toLocaleString('hu-HU', { maximumFractionDigits: 1 })} l` : ''}${f.amount ? ` · ${formatHuf(Number(f.amount))}` : ''}` })
      for (const x of inc.data ?? []) items.push({ at: x.created_at, icon: 'alert-triangle', text: `Esemény / baleset${x.note ? ` — ${x.note}` : ''}`, warn: true })
      const hNames = await resolveNames((hand.data ?? []).flatMap((h) => [h.from_user, h.to_user]))
      for (const h of hand.data ?? []) {
        const code = (h.route as unknown as { code: string } | null)?.code ?? '?'
        const at = `${(h.stop_index ?? 0) + 1}. boxtól`
        items.push({ at: h.created_at, icon: 'repeat', warn: true, text: h.to_user === userId
          ? `Átvette a(z) ${code} járatot (${h.round}. kör)${h.from_user ? ` — ${hNames[h.from_user] ?? 'kollégától'}` : ''}, a(z) ${at}${h.reason ? ` · ${h.reason}` : ''}`
          : `A(z) ${code} járatát (${h.round}. kör) átvette ${hNames[h.to_user] ?? 'egy kolléga'}, a(z) ${at}${h.reason ? ` · ${h.reason}` : ''}` })
      }
      return items.sort((a, b) => a.at.localeCompare(b.at))
    },
  })
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="card-title" style={{ margin: 0 }}><Icon name="history" />Egy nap idővonala</div>
        {dates.length > 0 && (
          <select className="select" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 'auto', minHeight: 34 }} aria-label="Nap kiválasztása">
            {dates.slice(0, 120).map((d) => <option key={d} value={d}>{formatDate(d)}</option>)}
          </select>
        )}
      </div>
      {dates.length === 0 && <div className="tiny muted">Az időszakban nincs olyan nap, amikor be volt osztva vagy becsekkolt.</div>}
      {isLoading && <div className="tiny muted">Betöltés…</div>}
      {isError && <div className="alert error">Az idővonal betöltése nem sikerült: {errMsg(error, 'ismeretlen hiba')}</div>}
      {data && data.length === 0 && <div className="tiny muted">Ezen a napon nem rögzített semmit az alkalmazásban.</div>}
      {data && data.length > 0 && (
        <div className="stack" style={{ gap: 0 }}>
          {data.map((x, i) => (
            <div key={i} className="row small" style={{ gap: 10, padding: '5px 0', borderTop: i ? '1px solid var(--border)' : 'none', alignItems: 'flex-start' }}>
              <span className="num" style={{ fontWeight: 700, minWidth: 44, fontVariantNumeric: 'tabular-nums' }}>{hhmm(x.at)}</span>
              <Icon name={x.icon} size={16} style={{ flexShrink: 0, marginTop: 2, color: x.warn ? 'var(--warning)' : 'var(--text-dim)' }} />
              <span style={{ overflowWrap: 'anywhere' }}>{x.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
