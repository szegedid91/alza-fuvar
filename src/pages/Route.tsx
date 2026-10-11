import { lazy, Suspense, useEffect, useRef, useState } from 'react'
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
import { resolveNames, telHref } from '../lib/names'
import ConfirmButton from '../components/ConfirmButton'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'
import { formatHuf, formatDateTime, parseHuNumber } from '../lib/labels'
import type { Car } from '../lib/checkin'
import { routeUploadQuery, routeStopsQuery } from '../lib/routeQueries'
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

  // Közös lekérdezés a becsekkolás utáni előtöltéssel (routeQueries) — ha a
  // sofőr a beolvasás után jön ide, a terv már a cache-ben van.
  const { data: upload, isLoading } = useQuery({
    ...routeUploadQuery(currentWorkspaceId ?? '', car.id, date),
    enabled: !!currentWorkspaceId,
  })

  if (isLoading) return <Skeleton rows={4} />
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
    <div className="card stack primary">
      <div className="card-title" style={{ margin: 0 }}><Icon name="map" />Fuvarterv importálása — {car.plate}</div>
      <p className="small muted" style={{ margin: 0 }}>
        Ma még nincs fuvarterved ehhez az autóhoz. Tölts fel egy Excel fájlt (több munkalap — XL/RPL/AB — is lehet benne),
        vagy várd meg, amíg a menedzser feltölti: akkor itt magától megjelenik.
      </p>
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
      {count != null && <div className="alert success row" style={{ gap: 8 }}><Icon name="check-circle" />{count} stop importálva.</div>}
      <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
        <Icon name="file-text" />{busy ? 'Feldolgozás…' : 'Excel kiválasztása'}
      </button>
    </div>
  )
}

function StopList({ upload, onReimport }: { upload: Upload; onReimport: () => void }) {
  const qc = useQueryClient()
  const [items, setItems] = useState<Stop[]>([])
  const [showMap, setShowMap] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }))

  const { data: stops } = useQuery(routeStopsQuery(upload.id))
  // A szerverről jövő lista minden (újra)letöltés után felülírja a helyi
  // sorrendet — a cache-ből (előtöltésből) jövő adatnál is.
  useEffect(() => { if (stops) setItems(stops) }, [stops])

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

  const nextId = list.find((x) => x.status === 'pending')?.id ?? null
  const doneCount = list.filter((x) => x.status !== 'pending').length

  return (
    <>
      <RouteSummary stops={list} startPoi={upload.start_poi} endPoi={upload.end_poi} />

      <div className="btn-grid">
        <button className="btn secondary sm" onClick={() => void sortByTime()}><Icon name="clock" />Idősáv szerint</button>
        <button className="btn secondary sm" onClick={() => setShowMap((v) => !v)}><Icon name="map" />{showMap ? 'Térkép bezárása' : 'Térkép'}</button>
      </div>

      {orderError && <div className="alert error">{orderError}</div>}

      {showMap && (
        <Suspense fallback={<div className="card"><div className="spinner" /></div>}>
          <RouteMapLazy stops={list} />
        </Suspense>
      )}

      {list.length > 0 && (
        <div className="card" style={{ padding: '10px 14px' }}>
          <div className="between">
            <span className="num num-lg">{doneCount}<span className="muted" style={{ fontWeight: 600, fontSize: 15 }}>/{list.length} stop kész</span></span>
            <span className="small muted">{list.length - doneCount} hátra</span>
          </div>
          <div className="progress" aria-hidden="true"><div style={{ width: `${list.length ? Math.round((doneCount / list.length) * 100) : 0}%` }} /></div>
        </div>
      )}

      {/* Kompakt lista: a KÖVETKEZŐ stop nyitva, a többi egy soros — koppintásra
          nyílik. A kész stopok zölden, összecsukva maradnak a helyükön
          (a sorrend a sofőré, nem rendezzük át a háta mögött). */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={list.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="stack">
            {list.map((s, i) => <SortableStop key={s.id} stop={s} index={i} uploadId={upload.id} isNext={s.id === nextId} />)}
          </div>
        </SortableContext>
      </DndContext>

      <ConfirmButton className="btn ghost" confirmLabel="Biztosan? A mai terv törlődik" onConfirm={() => void deleteUpload()}>
        Új fuvarterv importálása
      </ConfirmButton>
    </>
  )
}

function SortableStop({ stop, index, uploadId, isNext }: { stop: Stop; index: number; uploadId: string; isNext: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }
  return (
    <div ref={setNodeRef} style={style}>
      <StopCard
        stop={stop}
        index={index}
        uploadId={uploadId}
        isNext={isNext}
        dragHandle={<span className="drag-handle" aria-label="Sorrend módosítása (húzd)" {...attributes} {...listeners}><Icon name="grip" /></span>}
      />
    </div>
  )
}

function StopCard({ stop, index, uploadId, isNext, dragHandle }: { stop: Stop; index: number; uploadId: string; isNext: boolean; dragHandle: React.ReactNode }) {
  const { profile } = useAuth()
  const qc = useQueryClient()
  // Nyitva: a következő stop automatikusan; a többi koppintásra. Ha a
  // "következő" tovább lép (mentés után), az új következő magától kinyílik.
  const [open, setOpen] = useState(isNext)
  useEffect(() => { if (isNext) setOpen(true) }, [isNext])
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
  const phoneHref = telHref(stop.phone)

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
    let ok = false
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
      ok = true
      setSaved(true); setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      // pl. zárolt hónap vagy jogosultsági hiba — látható hibaüzenet, nem néma elakadás
      setSaveError('Mentés sikertelen: ' + (e instanceof Error ? e.message : 'ismeretlen hiba'))
    } finally {
      setBusy(false)
    }
    await qc.invalidateQueries({ queryKey: ['route-stops', uploadId] })
    // kész → összecsukjuk, a következő stop nyílik ki helyette
    if (ok) setOpen(false)
  }

  async function skip(reason: string) {
    if (!profile) return
    setBusy(true); setShowSkip(false)
    setSaveError(null)
    let ok = false
    try {
      await submitNow({
        id: crypto.randomUUID(), table: 'route_stops', op: 'update', match: { id: stop.id },
        label: `Sikertelen – ${stop.city ?? ''}`,
        values: { status: 'skipped', skip_reason: reason, recorded_by: profile.id, recorded_at: new Date().toISOString() },
      })
      ok = true
    } catch (e) {
      setSaveError('Mentés sikertelen: ' + (e instanceof Error ? e.message : 'ismeretlen hiba'))
    } finally {
      setBusy(false)
    }
    await qc.invalidateQueries({ queryKey: ['route-stops', uploadId] })
    if (ok) setOpen(false)
  }

  const borderColor = stop.status === 'done' ? 'var(--success)' : stop.status === 'skipped' ? 'var(--danger)' : isNext ? 'var(--primary)' : undefined

  // ---- Összecsukott sor ----
  if (!open) {
    const summary = stop.status === 'done'
      ? <span className="row" style={{ gap: 4, color: 'var(--success)' }}><Icon name="check" size={16} />{stop.is_cash && stop.received_amount != null ? formatHuf(Number(stop.received_amount)) : 'kész'}</span>
      : stop.status === 'skipped' ? <span className="row" style={{ gap: 4, color: 'var(--danger)' }}><Icon name="x" size={16} />{stop.skip_reason ?? 'sikertelen'}</span>
      : (stop.time_window || stop.planned_time
        ? <span>{stop.time_window || stop.planned_time}</span>
        : stop.is_cash ? <span className="row" style={{ gap: 4 }}><Icon name="banknote" size={16} />{formatHuf(expected)}</span> : null)
    return (
      <div className="card stop-row" style={{ borderColor, padding: '8px 10px' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          {dragHandle}
          <span className="badge" style={{ flexShrink: 0 }}>{index + 1}.</span>
          <button
            type="button"
            className="stop-row-btn"
            onClick={() => setOpen(true)}
            aria-label={`${index + 1}. stop megnyitása: ${addrText}`}
          >
            <span className="stop-row-addr" style={{ opacity: stop.status === 'pending' ? 1 : 0.8 }}>{addrText || '(nincs cím)'}</span>
            <span className="small muted" style={{ flexShrink: 0 }}>{summary}</span>
          </button>
        </div>
      </div>
    )
  }

  // ---- Nyitott kártya ----
  return (
    <div className={`card stack stop-open${isNext && stop.status === 'pending' ? ' primary' : ''}`} style={{ borderColor }}>
      <div className="between">
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          {dragHandle}
          <span className="badge">{index + 1}.</span>
          {isNext && stop.status === 'pending' && <span className="badge primary">Következő</span>}
          {stop.status === 'done' && <span className="badge success"><Icon name="check" />Kész</span>}
          {stop.status === 'skipped' && <span className="badge danger"><Icon name="x" />Sikertelen</span>}
          {stop.sheet_name && <span className="tiny muted">{stop.sheet_name}</span>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {stop.time_window && <span className="small muted">{stop.time_window}</span>}
          <button type="button" className="icon-btn" aria-label="Összecsukás" onClick={() => setOpen(false)}><Icon name="chevron-up" /></button>
        </div>
      </div>

      <div>
        {editAddr ? (
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={addrText}
            onBlur={() => setEditAddr(false)} autoFocus />
        ) : (
          <div className="row between">
            <div style={{ fontWeight: 700 }}>{addrText || '(nincs cím)'}</div>
            <button className="icon-btn" aria-label="Cím szerkesztése" onClick={() => setEditAddr(true)}><Icon name="pencil" size={18} /></button>
          </div>
        )}
        {stop.planned_time && <div className="tiny muted">Tervezett: {stop.planned_time}</div>}
        {stop.note && <div className="small muted" style={{ marginTop: 4 }}>{stop.note}</div>}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn secondary sm" style={{ flex: 1 }} onClick={() => setShowNav((v) => !v)}><Icon name="navigation" />Navigáció</button>
        {phoneHref && (
          <a className="btn ghost sm" style={{ flex: 1, textDecoration: 'none' }} href={phoneHref}><Icon name="phone" />Hívás</a>
        )}
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
          <label className="row" style={{ gap: 6 }}><Icon name="banknote" size={16} />Készpénz — kapott összeg (várt: {formatHuf(expected)})</label>
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

      <div className="stop-actions">
        <button className="btn ghost" disabled={busy} onClick={() => setShowSkip((v) => !v)}>Sikertelen</button>
        <button className={`btn ${saved ? 'secondary' : ''}`} disabled={busy} onClick={() => void save()}>
          {saved ? <><Icon name="check" />Mentve</> : busy ? '…' : stop.status === 'done' ? 'Frissítés' : <><Icon name="check" />Kész</>}
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

function RouteSummary({ stops, startPoi, endPoi }: { stops: Stop[]; startPoi: string | null; endPoi: string | null }) {
  // Az összesítő a már letöltött stop-listából számol — nem kéri le még
  // egyszer ugyanazt a táblát. Csak a rögzítők nevét oldjuk fel (kötegelve).
  const recordedIds = [...new Set(stops.map((s) => s.recorded_by).filter((x): x is string => !!x))].sort()
  const { data: names } = useQuery({
    queryKey: ['stop-names', recordedIds],
    enabled: recordedIds.length > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: () => resolveNames(recordedIds),
  })
  // A sikertelen (skipped) stopokból nincs beszedett pénz — nem is leadandó
  const cashToHandOver = stops
    .filter((s) => s.is_cash && s.status !== 'skipped')
    .reduce((sum, s) => sum + Number(s.expected_amount ?? 0), 0)
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
      <div className="card-title"><Icon name="wallet" />Napi összesítő</div>
      {(startPoi || endPoi) && (
        <div className="tiny muted">{startPoi && `Kezdő: ${startPoi}`}{startPoi && endPoi ? ' · ' : ''}{endPoi && `Vég: ${endPoi}`}</div>
      )}
      <div className="grid-2 pay-grid">
        <div className="between"><span className="muted small">Stopok</span><span className="badge">{done}/{stops.length} kész{skipped ? ` · ${skipped} sikertelen` : ''}</span></div>
        <div className="between"><span className="muted small">Leadandó készpénz</span><span className="badge money"><Icon name="banknote" />{formatHuf(cashToHandOver)}</span></div>
        <div className="between"><span className="muted small">Beszedve</span><span className="badge">{formatHuf(collected)}</span></div>
        <div className="between"><span className="muted small">Borravaló</span><span className="badge success">{formatHuf(tips)}</span></div>
        {shortfall > 0 && (
          <div className="between"><span className="muted small">Kp-hiány</span><span className="badge danger">−{formatHuf(shortfall)}</span></div>
        )}
        <div className="between"><span className="muted small">Hátralévő kp. stop</span><span className="badge">{pendingCash.length} db</span></div>
        <div className="between"><span className="muted small">Beszedésre vár</span><span className="badge money">{formatHuf(pendingCashAmount)}</span></div>
      </div>
      {recorded.length > 0 && (
        <>
          <div className="divider" />
          <div className="card-title" style={{ marginBottom: 4 }}>Ki mit rögzített</div>
          <div className="list">
            {recorded.map((s) => (
              <div key={s.id} className="between">
                <span className="small">{s.city ?? s.street ?? 'Stop'} — {s.recorded_by ? names?.[s.recorded_by] ?? 'Ismeretlen' : ''}</span>
                <span className="tiny muted">{s.is_cash ? formatHuf(Number(s.received_amount ?? 0)) : 'előre fiz.'} · {formatDateTime(s.recorded_at)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
