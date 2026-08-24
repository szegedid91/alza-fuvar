import { lazy, Suspense, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import RequireCheckin from '../components/RequireCheckin'
import InspectionGate from '../components/InspectionGate'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { supabase } from '../lib/supabase'
import { submitNow } from '../lib/outbox'
import { parseRouteExcel } from '../lib/excel'
import { stopAddressText, navUrl, navAppLabel, type NavApp } from '../lib/nav'
import { resolveNames } from '../lib/names'
import ConfirmButton from '../components/ConfirmButton'
import { formatHuf, formatDateTime, parseHuNumber } from '../lib/labels'
import type { Car } from '../lib/checkin'
import type { Tables } from '../lib/database.types'

const RouteMapLazy = lazy(() => import('../components/RouteMap'))

type Stop = Tables<'route_stops'>
type Upload = Tables<'route_uploads'>

export default function RoutePage() {
  return (
    <div className="stack">
      <h2>Fuvarterv</h2>
      <RequireCheckin>{({ car, date }) => (
        <InspectionGate carId={car.id} date={date}><RouteInner car={car} date={date} /></InspectionGate>
      )}</RequireCheckin>
    </div>
  )
}

function RouteInner({ car, date }: { car: Car; date: string }) {
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()

  const { data: upload, isLoading } = useQuery({
    queryKey: ['route-upload', currentWorkspaceId, car.id, date],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('route_uploads').select('*')
        .eq('workspace_id', currentWorkspaceId!).eq('car_id', car.id).eq('work_date', date)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      // Hiba esetén dobni kell — különben "nincs fuvarterv"-nek látszana, és
      // a sofőr duplán importálná a tervet.
      if (error) throw error
      return (data as Upload | null) ?? null
    },
  })

  if (isLoading) return <div className="card"><div className="spinner" /></div>
  if (!upload) return <ImportCard car={car} date={date} onDone={() => qc.invalidateQueries({ queryKey: ['route-upload'] })} />
  // key: új importnál a lista-állapot (items) ne ragadjon be az előző fuvartervről
  return <StopList key={upload.id} upload={upload} onReimport={() => qc.invalidateQueries({ queryKey: ['route-upload'] })} />
}

function ImportCard({ car, date, onDone }: { car: Car; date: string; onDone: () => void }) {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const fileRef = useRef<HTMLInputElement>(null)
  const [startPoi, setStartPoi] = useState('')
  const [endPoi, setEndPoi] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)

  async function handleFile(file: File) {
    if (!currentWorkspaceId || !profile) return
    setBusy(true); setError(null); setCount(null)
    try {
      const stops = await parseRouteExcel(file)
      if (stops.length === 0) { setError('Nem találtam stopokat a fájlban.'); setBusy(false); return }

      const uploadId = crypto.randomUUID()
      const { error: uErr } = await supabase.from('route_uploads').insert({
        id: uploadId, workspace_id: currentWorkspaceId, work_date: date, car_id: car.id,
        uploaded_by: profile.id, file_name: file.name, start_poi: startPoi.trim() || null, end_poi: endPoi.trim() || null,
      })
      if (uErr) throw uErr

      const rows = stops.map((s, i) => ({
        upload_id: uploadId, workspace_id: currentWorkspaceId, sheet_name: s.sheet_name,
        seq: s.seq, display_order: i, street: s.street, postal_code: s.postal_code, city: s.city,
        cod_amount: s.cod_amount, payment_method: s.payment_method, time_window: s.time_window,
        planned_time: s.planned_time, note: s.note, weight: s.weight, phone: s.phone,
        is_cash: s.is_cash, expected_amount: s.expected_amount,
      }))
      const { error: sErr } = await supabase.from('route_stops').insert(rows)
      if (sErr) throw sErr

      setCount(stops.length)
      onDone()
    } catch (e) {
      setError('Hiba: ' + (e instanceof Error ? e.message : 'ismeretlen'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card stack">
      <div className="card-title">Fuvarterv importálása — {car.plate}</div>
      <p className="small muted">Tölts fel egy Excel fájlt a mai útvonaladdal. Több munkalap (XL/RPL/AB) is lehet benne.</p>
      <div className="field">
        <label>Kezdő POI (depó címe)</label>
        <input className="input" value={startPoi} onChange={(e) => setStartPoi(e.target.value)} placeholder="pl. Budapest, Depó u. 1." />
      </div>
      <div className="field">
        <label>Vég POI (depó címe)</label>
        <input className="input" value={endPoi} onChange={(e) => setEndPoi(e.target.value)} placeholder="pl. Budapest, Depó u. 1." />
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }} />
      {error && <div className="alert error">{error}</div>}
      {count != null && <div className="alert success">{count} stop importálva.</div>}
      <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? 'Feldolgozás…' : '📄 Excel kiválasztása'}
      </button>
    </div>
  )
}

function StopList({ upload, onReimport }: { upload: Upload; onReimport: () => void }) {
  const qc = useQueryClient()
  const [items, setItems] = useState<Stop[]>([])
  const [showMap, setShowMap] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }))

  const { data: stops } = useQuery({
    queryKey: ['route-stops', upload.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('route_stops').select('*').eq('upload_id', upload.id)
        .order('display_order', { ascending: true, nullsFirst: false })
      if (error) throw error
      const rows = (data ?? []) as Stop[]
      setItems(rows)
      return rows
    },
  })

  const [orderError, setOrderError] = useState<string | null>(null)

  const list = items.length ? items : (stops ?? [])

  // Új sorrend mentése EGY kéréssel (nem stoponként), hibajelzéssel.
  async function applyOrder(next: Stop[]) {
    setItems(next)
    setOrderError(null)
    const payload = next.map((s, i) => ({ id: s.id, workspace_id: s.workspace_id, upload_id: s.upload_id, display_order: i }))
    try {
      const { error } = await supabase.from('route_stops').upsert(payload, { onConflict: 'id' })
      if (error) throw error
    } catch (e) {
      setOrderError('A sorrend mentése nem sikerült (offline?). Újratöltés után a régi sorrend látszik. ' + (e instanceof Error ? e.message : ''))
    }
    await qc.invalidateQueries({ queryKey: ['route-stops', upload.id] })
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    // A megjelenített listán dolgozunk (cache-visszatöltésnél az items még üres lehet)
    const oldIndex = list.findIndex((s) => s.id === active.id)
    const newIndex = list.findIndex((s) => s.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    await applyOrder(arrayMove([...list], oldIndex, newIndex))
  }

  async function sortByTime() {
    // Idő nélküli stopok a lista VÉGÉRE — a '~' minden számjegy után rendeződik
    // (a korábbi 'zzzz'.padStart(5) a '0zzzz' miatt a lista közepére került)
    const key = (s: Stop) => {
      const t = s.planned_time || s.time_window
      return t ? t.padStart(5, '0') : '~~~~~'
    }
    // Kódpont szerinti összevetés — a localeCompare a '~' jelet a számok elé sorolhatná
    await applyOrder([...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)))
  }

  // FIGYELEM: window.confirm az iOS PWA-ban némán hamisat ad — ConfirmButton kell
  async function deleteUpload() {
    await supabase.from('route_uploads').delete().eq('id', upload.id)
    onReimport()
  }

  return (
    <>
      <RouteSummary uploadId={upload.id} startPoi={upload.start_poi} endPoi={upload.end_poi} />

      <div className="btn-grid">
        <button className="btn secondary sm" onClick={() => void sortByTime()}>🕒 Idősáv szerint</button>
        <button className="btn secondary sm" onClick={() => setShowMap((v) => !v)}>🗺️ {showMap ? 'Térkép bezárása' : 'Térkép'}</button>
      </div>

      {orderError && <div className="alert error">{orderError}</div>}

      {showMap && (
        <Suspense fallback={<div className="card"><div className="spinner" /></div>}>
          <RouteMapLazy stops={list} />
        </Suspense>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={list.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="stack">
            {list.map((s, i) => <SortableStop key={s.id} stop={s} index={i} uploadId={upload.id} />)}
          </div>
        </SortableContext>
      </DndContext>

      <ConfirmButton className="btn ghost" confirmLabel="Biztosan? A mai terv törlődik" onConfirm={() => void deleteUpload()}>
        Új fuvarterv importálása
      </ConfirmButton>
    </>
  )
}

function SortableStop({ stop, index, uploadId }: { stop: Stop; index: number; uploadId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }
  return (
    <div ref={setNodeRef} style={style}>
      <StopCard stop={stop} index={index} uploadId={uploadId} dragHandle={<span className="drag-handle" {...attributes} {...listeners}>⠿</span>} />
    </div>
  )
}

function StopCard({ stop, index, uploadId, dragHandle }: { stop: Stop; index: number; uploadId: string; dragHandle: React.ReactNode }) {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [received, setReceived] = useState(stop.received_amount != null ? String(stop.received_amount) : '')
  const [eventNote, setEventNote] = useState(stop.event_note ?? '')
  const [address, setAddress] = useState(stop.address_override ?? '')
  const [editAddr, setEditAddr] = useState(false)
  const [showNav, setShowNav] = useState(false)
  const [showSkip, setShowSkip] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const addrText = stopAddressText({ ...stop, address_override: address || stop.address_override })
  const expected = Number(stop.expected_amount ?? 0)
  const recvNum = received !== '' ? parseHuNumber(received) : null
  const tip = recvNum != null && Number.isFinite(recvNum) ? recvNum - expected : null

  function openNav(app: NavApp) {
    window.open(navUrl(app, addrText), '_blank')
    setShowNav(false)
  }

  async function save() {
    if (!profile) return
    if (received !== '' && !Number.isFinite(recvNum)) {
      setSaveError('Érvénytelen összeg.')
      return
    }
    setBusy(true)
    setSaveError(null)
    try {
      const recv = Number.isFinite(recvNum as number) ? recvNum : null
      await submitNow({
        id: crypto.randomUUID(), table: 'route_stops', op: 'update', match: { id: stop.id },
        label: `Stop rögzítés – ${stop.city ?? ''}`,
        values: {
          received_amount: recv,
          tip: recv != null && stop.is_cash ? recv - expected : null,
          event_note: eventNote.trim() || null,
          address_override: address.trim() || null,
          status: 'done', recorded_by: profile.id, recorded_at: new Date().toISOString(),
        },
      })
      setSaved(true); setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      // pl. zárolt hónap vagy jogosultsági hiba — látható hibaüzenet, nem néma elakadás
      setSaveError('Mentés sikertelen: ' + (e instanceof Error ? e.message : 'ismeretlen hiba'))
    } finally {
      setBusy(false)
    }
    await qc.invalidateQueries({ queryKey: ['route-stops', uploadId] })
    await qc.invalidateQueries({ queryKey: ['route-summary', uploadId] })
  }

  async function skip(reason: string) {
    if (!profile) return
    setBusy(true); setShowSkip(false)
    setSaveError(null)
    try {
      await submitNow({
        id: crypto.randomUUID(), table: 'route_stops', op: 'update', match: { id: stop.id },
        label: `Sikertelen – ${stop.city ?? ''}`,
        values: { status: 'skipped', skip_reason: reason, recorded_by: profile.id, recorded_at: new Date().toISOString() },
      })
    } catch (e) {
      setSaveError('Mentés sikertelen: ' + (e instanceof Error ? e.message : 'ismeretlen hiba'))
    } finally {
      setBusy(false)
    }
    await qc.invalidateQueries({ queryKey: ['route-stops', uploadId] })
    await qc.invalidateQueries({ queryKey: ['route-summary', uploadId] })
  }

  const borderColor = stop.status === 'done' ? 'var(--success)' : stop.status === 'skipped' ? 'var(--danger)' : undefined

  return (
    <div className="card stack" style={{ borderColor }}>
      <div className="between">
        <div className="row" style={{ gap: 8 }}>
          {dragHandle}
          <span className="badge">{index + 1}.</span>
          {stop.sheet_name && <span className="badge primary">{stop.sheet_name}</span>}
          {stop.is_cash && <span className="badge warning">Készpénz</span>}
          {stop.status === 'done' && <span className="badge success">✔</span>}
          {stop.status === 'skipped' && <span className="badge danger">Sikertelen</span>}
        </div>
        {stop.time_window && <span className="tiny muted">{stop.time_window}</span>}
      </div>

      <div>
        {editAddr ? (
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={addrText}
            onBlur={() => setEditAddr(false)} autoFocus />
        ) : (
          <div className="row between">
            <div style={{ fontWeight: 700 }}>{addrText || '(nincs cím)'}</div>
            <button className="btn ghost sm auto" onClick={() => setEditAddr(true)}>✎</button>
          </div>
        )}
        {stop.planned_time && <div className="tiny muted">Tervezett: {stop.planned_time}</div>}
        {stop.note && <div className="small muted" style={{ marginTop: 4 }}>📝 {stop.note}</div>}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn secondary sm" style={{ flex: 1 }} onClick={() => setShowNav((v) => !v)}>🧭 Navigáció</button>
        <button className="btn ghost sm" style={{ flex: 1 }} disabled title="Nincs adatforrás (kikapcsolva)">📞 Hívás</button>
      </div>
      {showNav && (
        <div className="grid-3">
          {(['google', 'waze', 'apple'] as NavApp[]).map((a) => (
            <button key={a} className="btn secondary sm" onClick={() => openNav(a)}>{navAppLabel[a]}</button>
          ))}
        </div>
      )}

      {stop.is_cash && (
        <div className="field">
          <label>Kapott összeg (várt: {formatHuf(expected)})</label>
          <input className="input" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} placeholder={String(expected)} />
          {tip != null && (
            <div className={`small ${tip < 0 ? 'badge danger' : 'badge success'}`} style={{ marginTop: 6, width: 'fit-content' }}>
              {tip < 0 ? `Hiány: ${formatHuf(tip)}` : `Borravaló: ${formatHuf(tip)}`}
            </div>
          )}
        </div>
      )}

      <div className="field">
        <label>Esemény</label>
        <input className="input" value={eventNote} onChange={(e) => setEventNote(e.target.value)} placeholder="pl. nem volt otthon" />
      </div>

      {stop.status === 'skipped' && stop.skip_reason && (
        <div className="badge danger" style={{ width: 'fit-content' }}>Ok: {stop.skip_reason}</div>
      )}

      {saveError && <div className="alert error">{saveError}</div>}

      <div className="btn-grid">
        <button className="btn ghost sm" disabled={busy} onClick={() => setShowSkip((v) => !v)}>Sikertelen</button>
        <button className={`btn sm ${saved ? 'secondary' : ''}`} disabled={busy} onClick={() => void save()}>
          {saved ? '✔ Mentve' : busy ? '…' : stop.status === 'done' ? 'Frissítés' : 'Kész'}
        </button>
      </div>
      {showSkip && (
        <div className="stack">
          {['Nem volt otthon', 'Átvevő elutasította', 'Rossz cím', 'Egyéb'].map((r) => (
            <button key={r} className="btn secondary sm" disabled={busy} onClick={() => void skip(r)}>{r}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function RouteSummary({ uploadId, startPoi, endPoi }: { uploadId: string; startPoi: string | null; endPoi: string | null }) {
  const { data } = useQuery({
    queryKey: ['route-summary', uploadId],
    queryFn: async () => {
      const { data, error } = await supabase.from('route_stops').select('*').eq('upload_id', uploadId)
      if (error) throw error
      const stops = (data ?? []) as Stop[]
      const names = await resolveNames(stops.map((s) => s.recorded_by))
      return { stops, names }
    },
  })
  if (!data) return null
  const { stops, names } = data
  const cashToHandOver = stops.filter((s) => s.is_cash).reduce((sum, s) => sum + Number(s.expected_amount ?? 0), 0)
  const collected = stops.reduce((sum, s) => sum + Number(s.received_amount ?? 0), 0)
  // Borravaló és kp-hiány külön (a hiány nem "negatív borravaló" — bérszámítási szabály)
  const tips = stops.reduce((sum, s) => sum + Math.max(0, Number(s.tip ?? 0)), 0)
  const shortfall = stops.reduce((sum, s) => sum + Math.max(0, -Number(s.tip ?? 0)), 0)
  const done = stops.filter((s) => s.status === 'done').length
  const skipped = stops.filter((s) => s.status === 'skipped').length
  const recorded = stops.filter((s) => s.recorded_by)
  // Hátralévő készpénzes stopok (még nincs beszedve)
  const pendingCash = stops.filter((s) => s.is_cash && s.status === 'pending')
  const pendingCashAmount = pendingCash.reduce((sum, s) => sum + Number(s.expected_amount ?? 0), 0)

  return (
    <div className="card stack">
      <div className="card-title">Napi összesítő</div>
      {(startPoi || endPoi) && (
        <div className="tiny muted">{startPoi && `Kezdő: ${startPoi}`}{startPoi && endPoi ? ' · ' : ''}{endPoi && `Vég: ${endPoi}`}</div>
      )}
      <div className="grid-2">
        <div className="between"><span className="muted small">Stopok</span><span className="badge">{done}/{stops.length} kész{skipped ? ` · ${skipped} sikertelen` : ''}</span></div>
        <div className="between"><span className="muted small">Leadandó készpénz</span><span className="badge warning">{formatHuf(cashToHandOver)}</span></div>
        <div className="between"><span className="muted small">Beszedve</span><span className="badge">{formatHuf(collected)}</span></div>
        <div className="between"><span className="muted small">Borravaló</span><span className="badge success">{formatHuf(tips)}</span></div>
        {shortfall > 0 && (
          <div className="between"><span className="muted small">Kp-hiány</span><span className="badge danger">−{formatHuf(shortfall)}</span></div>
        )}
        <div className="between"><span className="muted small">Hátralévő kp. stop</span><span className="badge">{pendingCash.length} db</span></div>
        <div className="between"><span className="muted small">Beszedésre vár</span><span className="badge warning">{formatHuf(pendingCashAmount)}</span></div>
      </div>
      {recorded.length > 0 && (
        <>
          <div className="divider" />
          <div className="card-title" style={{ marginBottom: 4 }}>Ki mit rögzített</div>
          <div className="list">
            {recorded.map((s) => (
              <div key={s.id} className="between">
                <span className="small">{s.city ?? s.street ?? 'Stop'} — {s.recorded_by ? names[s.recorded_by] ?? 'Ismeretlen' : ''}</span>
                <span className="tiny muted">{s.is_cash ? formatHuf(Number(s.received_amount ?? 0)) : 'előre fiz.'} · {formatDateTime(s.recorded_at)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
