import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { useAlzaBoxes } from '../hooks/useAlzaBoxes'
import RequireCheckin from '../components/RequireCheckin'
import StopPhotos from '../components/StopPhotos'
import InspectionGate from '../components/InspectionGate'
import ConfirmButton from '../components/ConfirmButton'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'
import { resolveNames } from '../lib/names'
import { formatDate } from '../lib/labels'
import { toast } from '../lib/toast'
import {
  STOP_FIELDS, COMP_FIELDS, RET_FIELDS, WH_FIELDS, stopTotals, searchBoxes, isBoxCode, hhmmOfISO,
  type BoxSheet, type BoxStop, type AlzaBox,
} from '../lib/boxSheet'
import type { Car } from '../lib/checkin'

// Napi Box-lap: a papír "AlzaBox szállítási lap" digitális mása. Csak a
// Box-kategóriás (box_sheet = true) autókhoz kell — az XL-eseknek nem.
// Munkatárs: a mai lapja (a becsekkolt autóhoz, automatikusan létrejön).
// Menedzser: ?sheet=<id> paraméterrel bármelyik lap szerkeszthető.
export default function BoxSheetPage() {
  const { profile } = useAuth()
  const [params] = useSearchParams()
  const sheetParam = params.get('sheet')
  const isManager = profile?.role === 'manager' || profile?.role === 'admin'

  if (isManager) {
    return (
      <div className="stack">
        <h2>Box-lap</h2>
        {sheetParam ? (
          <>
            <Link to="/box-lapok" className="tiny muted row" style={{ gap: 4, textDecoration: 'none' }}><Icon name="arrow-left" size={14} />Vissza a Box-lapokhoz</Link>
            <SheetEditor sheetId={sheetParam} managerView />
          </>
        ) : (
          <div className="empty">
            <span className="ico"><Icon name="package" size={40} /></span>
            A munkatársak lapjait a Box-lapok oldalon találod.
            <div style={{ marginTop: 16 }}><Link to="/box-lapok" className="btn auto" style={{ display: 'inline-flex', textDecoration: 'none' }}>Box-lapok</Link></div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="stack">
      <h2>Box-lap</h2>
      <RequireCheckin>{({ car, date }) => <InspectionGate carId={car.id} date={date}><CrewSheet car={car} date={date} /></InspectionGate>}</RequireCheckin>
    </div>
  )
}

function CrewSheet({ car, date }: { car: Car; date: string }) {
  const { profile } = useAuth()
  // A járat-kártyáról érkezve (?box=<id>) az aktuális box megállója automatikusan felkerül a lapra
  const [params] = useSearchParams()
  const prefillBox = params.get('box')
  const { currentWorkspaceId } = useWorkspace()
  const { data: today } = useToday()
  const category = today?.car?.category ?? null
  const needsSheet = !!category?.box_sheet

  // A mai lap: ha még nincs, létrehozzuk (egy ember – egy nap – egy lap)
  const sheetQ = useQuery({
    queryKey: ['box-sheet-today', currentWorkspaceId, profile?.id, date],
    enabled: needsSheet && !!currentWorkspaceId && !!profile,
    queryFn: async () => {
      const { data, error } = await supabase.from('box_sheets').select('id')
        .eq('workspace_id', currentWorkspaceId!).eq('user_id', profile!.id).eq('work_date', date).maybeSingle()
      if (error) throw error
      if (data) return data.id
      const { data: ins, error: e2 } = await supabase.from('box_sheets')
        .insert({ workspace_id: currentWorkspaceId!, user_id: profile!.id, car_id: car.id, work_date: date }).select('id').single()
      if (e2) throw e2
      return ins.id
    },
  })

  if (!needsSheet) {
    return (
      <div className="card stack">
        <div className="alert info row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <Icon name="info" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>Ehhez az autóhoz ({car.plate}{category ? `, ${category.name}` : ''}) nem kell Box-lap — csak az AlzaBox-szállító autókhoz.</span>
        </div>
        <Link to="/boxok" className="btn ghost" style={{ textDecoration: 'none' }}><Icon name="search" />AlzaBox kereső</Link>
      </div>
    )
  }
  if (sheetQ.isLoading) return <Skeleton rows={5} />
  if (sheetQ.isError || !sheetQ.data) {
    return <div className="alert error">Nem sikerült megnyitni a mai lapot: {sheetQ.error instanceof Error ? sheetQ.error.message : ''}</div>
  }
  return <SheetEditor sheetId={sheetQ.data} prefillBoxId={prefillBox} />
}

type SheetRow = BoxSheet & { car: { plate: string } | null }

export function SheetEditor({ sheetId, managerView = false, prefillBoxId = null }: { sheetId: string; managerView?: boolean; prefillBoxId?: string | null }) {
  const qc = useQueryClient()
  const { data: boxes } = useAlzaBoxes()
  const boxById = useMemo(() => new Map((boxes ?? []).map((b) => [b.id, b])), [boxes])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['box-sheet', sheetId],
    queryFn: async () => {
      const [{ data: sheet, error: e1 }, { data: stops, error: e2 }] = await Promise.all([
        supabase.from('box_sheets').select('*, car:cars(plate)').eq('id', sheetId).single(),
        supabase.from('box_sheet_stops').select('*').eq('sheet_id', sheetId).order('seq').order('created_at'),
      ])
      if (e1) throw e1
      if (e2) throw e2
      const names = await resolveNames([sheet.user_id])
      return { sheet: sheet as unknown as SheetRow, stops: (stops ?? []) as BoxStop[], name: names[sheet.user_id] ?? null }
    },
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['box-sheet', sheetId] })
    void qc.invalidateQueries({ queryKey: ['box-sheet-status'] })
    void qc.invalidateQueries({ queryKey: ['box-sheets'] })
  }
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : 'A mentés nem sikerült')

  const updateSheet = useMutation({
    mutationFn: async (patch: Partial<BoxSheet>) => {
      const { error } = await supabase.from('box_sheets').update(patch).eq('id', sheetId)
      if (error) throw error
    },
    onSuccess: invalidate, onError: fail,
  })
  const addStop = useMutation({
    mutationFn: async (box: AlzaBox | { code: string }) => {
      const seq = (data?.stops.reduce((m, s) => Math.max(m, s.seq), 0) ?? 0) + 1
      const row = 'id' in box
        ? { box_id: box.id, box_code: box.code, box_name: box.name }
        : { box_code: box.code.toUpperCase(), box_name: null }
      const now = new Date()
      const { error } = await supabase.from('box_sheet_stops')
        .insert({ sheet_id: sheetId, workspace_id: data!.sheet.workspace_id, seq, done_at: now.toISOString(), ...row })
      if (error) throw error
      // A lap „végzés” ideje = az utolsó box ideje (a futár ekkor nyomott rá a Box-lapra ennél a boxnál)
      const hm = now.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', hour12: false })
      const { error: e2 } = await supabase.from('box_sheets').update({ end_time: hm }).eq('id', sheetId)
      if (e2) throw e2
    },
    onSuccess: invalidate, onError: fail,
  })
  const updateStop = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<BoxStop> }) => {
      const { error } = await supabase.from('box_sheet_stops').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate, onError: fail,
  })
  const removeStop = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('box_sheet_stops').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate, onError: fail,
  })

  // ?box=<id>: ha a box még nincs a lapon, egyszer felvesszük (a lista végére kerül, és kinyílik a kitöltéshez)
  const prefilledRef = useRef<string | null>(null)
  useEffect(() => {
    if (!prefillBoxId || !data || prefilledRef.current === prefillBoxId || addStop.isPending) return
    if (data.stops.some((st) => st.box_id === prefillBoxId)) { prefilledRef.current = prefillBoxId; return }
    const box = boxById.get(prefillBoxId)
    if (!box || data.sheet.status === 'submitted') return
    prefilledRef.current = prefillBoxId
    addStop.mutate(box)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillBoxId, data, boxById])

  if (isLoading) return <Skeleton rows={5} />
  if (isError || !data) return <div className="alert error">Nem sikerült betölteni a lapot: {error instanceof Error ? error.message : ''}</div>

  const { sheet, stops, name } = data
  const totals = stopTotals(stops)
  const submitted = sheet.status === 'submitted'
  const saving = updateSheet.isPending || updateStop.isPending || addStop.isPending || removeStop.isPending

  return (
    <>
      <div className="card stack" style={{ gap: 10 }}>
        <div className="between" style={{ alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div className="card-title" style={{ margin: 0 }}><Icon name="clipboard" />{formatDate(sheet.work_date)}</div>
            <div className="tiny muted">{name ?? '–'} · {sheet.car?.plate ?? 'autó nélkül'}</div>
          </div>
          {submitted
            ? <span className="badge success"><Icon name="check" />Lezárva {hhmmOfISO(sheet.submitted_at)}</span>
            : <span className="badge">Piszkozat{saving ? ' · mentés…' : ''}</span>}
        </div>
        <div className="grid-2">
          <TimeField label="Végzés (box) — automatikus" value={sheet.end_time} onCommit={(v) => updateSheet.mutate({ end_time: v })} />
          <div className="tiny muted" style={{ alignSelf: 'end' }}>A végzés ideje akkor rögzül, amikor a járat-kártyáról rányomsz a Box-lapra az aktuális boxnál (az utolsó box ideje). Kézzel javítható.</div>
        </div>
      </div>

      {prefillBoxId && (
        <Link to="/" className="btn" style={{ textDecoration: 'none' }}>
          <Icon name="arrow-left" />Vissza a járathoz
        </Link>
      )}

      <div className="card stack" style={{ gap: 10 }}>
        <div className="between">
          <div className="card-title" style={{ margin: 0 }}><Icon name="package" />{prefillBoxId ? 'Aktuális box' : 'Megállók'}</div>
          <span className="badge primary num">{stops.length} box</span>
        </div>
        {prefillBoxId
          ? <div className="tiny muted">A járat aktuális boxa automatikusan ki van jelölve — csak a darabszámokat kell beírni. A többi megálló összecsukva alatta.</div>
          : <AddStop onAdd={(b) => addStop.mutate(b)} busy={addStop.isPending} />}
        {stops.length === 0 && !prefillBoxId && <div className="tiny muted">Még nincs megálló — keresd meg a boxot kód vagy név alapján, és add hozzá.</div>}
        {[...stops].sort((a, b) => (a.box_id === prefillBoxId ? -1 : b.box_id === prefillBoxId ? 1 : 0)).map((s) => {
          const i = stops.findIndex((x) => x.id === s.id)
          const focus = !!prefillBoxId && s.box_id === prefillBoxId
          return (
            <StopRow key={s.id} stop={s} index={i + 1} isLast={!prefillBoxId && i === stops.length - 1} focus={focus} box={s.box_id ? boxById.get(s.box_id) ?? null : null}
              courierName={name ?? 'Futár'} onPatch={(patch) => updateStop.mutate({ id: s.id, patch })} onRemove={() => removeStop.mutate(s.id)} />
          )
        })}
      </div>

      {stops.length > 0 && !prefillBoxId && (
        <div className="card stack" style={{ gap: 6 }}>
          <div className="card-title" style={{ margin: 0 }}><Icon name="calculator" />Összesen</div>
          <div className="grid-2" style={{ gap: 4 }}>
            {STOP_FIELDS.map((f) => (
              <div key={f.key} className="between">
                <span className="tiny muted">{f.short}</span>
                <span className="num" style={{ color: f.key !== 'placed' && totals[f.key] > 0 ? 'var(--warning)' : undefined }}>{totals[f.key]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!prefillBoxId && (
      <div className="card stack" style={{ gap: 8 }}>
        <div className="tiny muted" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Nap vége — raktárba visszaérve</div>
        <div className="tiny muted">Ezeket a nap legvégén, a raktárba visszaérve töltsd ki, az egész napra összesítve.</div>
        <div className="card-title" style={{ margin: 0 }}><Icon name="alert-triangle" />Raktári problémák</div>
        <div className="grid-2">
          {WH_FIELDS.slice(0, 2).map((f) => <NumField key={f.key} label={f.label} value={sheet[f.key]} onCommit={(v) => updateSheet.mutate({ [f.key]: v })} />)}
        </div>
        <NumField label={WH_FIELDS[2].label} value={sheet.wh_pallet_items} onCommit={(v) => updateSheet.mutate({ wh_pallet_items: v })} />
        <TextField label={'Megjegyzés („MENT” stb.)'} value={sheet.wh_note ?? ''} onCommit={(v) => updateSheet.mutate({ wh_note: v || null })} />
        <div className="card-title" style={{ margin: 0, marginTop: 6 }}><Icon name="truck" />Raktárban leadott (db)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {RET_FIELDS.map((f) => <NumField key={f.key} label={f.label} value={sheet[f.key]} onCommit={(v) => updateSheet.mutate({ [f.key]: v })} />)}
        </div>
      </div>
      )}

      {!prefillBoxId && (
      <div className="card stack" style={{ gap: 8 }}>
        <div className="card-title" style={{ margin: 0 }}><Icon name="wrench" />Komplikációk</div>
        <div className="grid-2">
          {COMP_FIELDS.map((f) => <NumField key={f.key} label={f.label} value={sheet[f.key]} onCommit={(v) => updateSheet.mutate({ [f.key]: v })} />)}
        </div>
        <TextField label="Egyéb" value={sheet.comp_note ?? ''} onCommit={(v) => updateSheet.mutate({ comp_note: v || null })} />
      </div>
      )}

      {!prefillBoxId && (
      <div className="card stack">
        {submitted ? (
          <div className="alert success row" style={{ gap: 8 }}>
            <Icon name="check-circle" />Lezárva {hhmmOfISO(sheet.submitted_at)}. Ha javítasz valamit, az automatikusan mentődik.
          </div>
        ) : (
          <>
            <ConfirmButton className="btn" confirmLabel="Biztos? Lap lezárása"
              disabled={stops.length === 0 || saving}
              onConfirm={() => updateSheet.mutate({ status: 'submitted', submitted_at: new Date().toISOString() })}>
              <Icon name="flag" />Lap lezárása (nap vége)
            </ConfirmButton>
            <p className="tiny muted" style={{ margin: 0, textAlign: 'center' }}>
              {stops.length === 0 ? 'Előbb adj hozzá megállót.' : 'Minden mező azonnal mentődik — a lezárás jelzi a vezetőnek, hogy a lap kész.'}
            </p>
          </>
        )}
        {managerView && <div className="tiny muted">Menedzserként szerkeszted {name ?? 'a munkatárs'} lapját — a módosítás a naplóba kerül.</div>}
      </div>
      )}
    </>
  )
}

// Megálló keresése a jegyzékben (kód / név) — kódra kézzel is felvehető
function AddStop({ onAdd, busy }: { onAdd: (box: AlzaBox | { code: string }) => void; busy: boolean }) {
  const { data: boxes } = useAlzaBoxes()
  const [q, setQ] = useState('')
  const results = useMemo(() => searchBoxes(boxes ?? [], q, 6), [boxes, q])
  const trimmed = q.trim()
  const pick = (b: AlzaBox | { code: string }) => { onAdd(b); setQ('') }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="input-icon">
        <Icon name="search" />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Box hozzáadása: kód vagy név (AB9103…)" autoComplete="off"
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); pick(results[0]) } }} />
      </div>
      {trimmed.length >= 2 && (
        <div className="list" style={{ gap: 6 }}>
          {results.map((b) => (
            <button key={b.id} type="button" className="list-item" disabled={busy} style={{ width: '100%', textAlign: 'left', cursor: 'pointer', padding: '8px 12px' }} onClick={() => pick(b)}>
              <div className="row" style={{ gap: 8 }}>
                <Icon name="plus" size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 700 }}>{b.code && <span className="num">{b.code} · </span>}{b.name}</div>
                  <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.address}</div>
                </div>
              </div>
            </button>
          ))}
          {results.length === 0 && isBoxCode(trimmed) && (
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => pick({ code: trimmed })}>
              <Icon name="plus" size={16} />Hozzáadás kézzel: {trimmed.toUpperCase()} (nincs a jegyzékben)
            </button>
          )}
          {results.length === 0 && !isBoxCode(trimmed) && <div className="tiny muted">Nincs találat — próbáld a box kódját (pl. AB9103).</div>}
        </div>
      )}
    </div>
  )
}

function StopRow({ stop, index, isLast, focus = false, box, courierName, onPatch, onRemove }: {
  stop: BoxStop; index: number; isLast: boolean; focus?: boolean; box: AlzaBox | null; courierName: string
  onPatch: (patch: Partial<BoxStop>) => void; onRemove: () => void
}) {
  // Az újonnan felvett (utolsó, még üres) megálló nyitva — a többi összecsukva,
  // hogy 10-20 boxnál is áttekinthető maradjon a lap. Járat-módban a kijelölt box nyitva.
  const [open, setOpen] = useState(focus || (isLast && stop.placed === 0 && !stop.note))
  useEffect(() => { if (!isLast && !focus) setOpen(false) }, [isLast, focus])
  useEffect(() => { if (focus) setOpen(true) }, [focus])
  const extras = STOP_FIELDS.filter((f) => f.key !== 'placed' && stop[f.key] > 0)
  const flagged = stop.shortage > 0 || stop.damaged > 0 || stop.left_on_car > 0
  return (
    <div className="stack" style={{ gap: 8, padding: 10, border: focus ? '2px solid var(--primary)' : `1px solid ${flagged ? 'var(--warning)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', background: focus ? 'var(--primary-ghost)' : undefined }}>
      <button type="button" className="between" style={{ background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', gap: 8 }} onClick={() => setOpen((o) => !o)}>
        <div style={{ minWidth: 0 }}>
          <div className="small" style={{ fontWeight: 800 }}>
            <span className="muted">{index}.</span> <span className="num">{stop.box_code ?? '—'}</span>
            {stop.done_at && <span className="tiny muted" style={{ fontWeight: 500, marginLeft: 6 }}>végzés {hhmmOfISO(stop.done_at)}</span>}
          </div>
          <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stop.box_name ?? box?.name ?? 'nincs a jegyzékben'}</div>
        </div>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          <span className="num num-lg">{stop.placed}</span><span className="tiny muted">db</span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} className="muted" />
        </div>
      </button>
      {!open && extras.length > 0 && (
        <div className="chips" style={{ gap: 4 }}>
          {extras.map((f) => <span key={f.key} className="badge warning">{f.short} {stop[f.key]}</span>)}
        </div>
      )}
      {!open && stop.note && <div className="tiny muted">{stop.note}</div>}
      {open && (
        <>
          <div className="grid-2">
            {STOP_FIELDS.map((f) => (
              <NumField key={f.key} label={f.label} value={stop[f.key]} onCommit={(v) => onPatch({ [f.key]: v })} highlight={f.key === 'placed'} autoFocus={f.key === 'placed' && (focus || isLast) && stop.placed === 0} />
            ))}
          </div>
          <TextField label="Komplikáció / megjegyzés" value={stop.note ?? ''} placeholder="pl. +1 talált csomag" onCommit={(v) => onPatch({ note: v || null })} />
          <StopPhotos stop={stop} boxLabel={`${stop.box_code ? stop.box_code + ' · ' : ''}${stop.box_name ?? box?.name ?? ''}`} courierName={courierName} onPatch={onPatch} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <ConfirmButton className="btn ghost sm auto" confirmLabel="Törlés?" onConfirm={onRemove}>
              <Icon name="trash" size={16} />Megálló törlése
            </ConfirmButton>
          </div>
        </>
      )}
    </div>
  )
}

// Számmező: szerkesztés közben helyi szöveg, elhagyáskor (blur) ment — így egy
// koppintás-sorozat nem indít mentést minden karakterre.
function NumField({ label, value, onCommit, highlight = false, autoFocus = false }: { label: string; value: number; onCommit: (v: number) => void; highlight?: boolean; autoFocus?: boolean }) {
  const [txt, setTxt] = useState(String(value))
  useEffect(() => { setTxt(String(value)) }, [value])
  return (
    <div className="field">
      <label>{label}</label>
      <input className="input num" inputMode="numeric" pattern="[0-9]*" value={txt} autoFocus={autoFocus}
        style={highlight ? { borderColor: 'var(--primary)' } : undefined}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setTxt(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
        onBlur={() => {
          const n = txt === '' ? 0 : parseInt(txt, 10)
          if (n !== value) onCommit(n); else setTxt(String(value))
        }} />
    </div>
  )
}

function TextField({ label, value, onCommit, placeholder }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [txt, setTxt] = useState(value)
  useEffect(() => { setTxt(value) }, [value])
  return (
    <div className="field">
      <label>{label}</label>
      <input className="input" value={txt} placeholder={placeholder} onChange={(e) => setTxt(e.target.value)}
        onBlur={() => { const v = txt.trim(); if (v !== value) onCommit(v) }} />
    </div>
  )
}

// "05:40:00" (DB) ↔ "05:40" (input)
function TimeField({ label, value, onCommit }: { label: string; value: string | null; onCommit: (v: string | null) => void }) {
  const norm = (v: string | null) => (v ? v.slice(0, 5) : '')
  const [txt, setTxt] = useState(norm(value))
  useEffect(() => { setTxt(norm(value)) }, [value])
  return (
    <div className="field">
      <label>{label}</label>
      <input className="input" type="time" value={txt}
        // A telefonos időválasztó nem mindig vált ki blur-t — teljes (ÓÓ:PP) értéknél azonnal mentünk
        onChange={(e) => { const v = e.target.value; setTxt(v); if (/^\d{2}:\d{2}$/.test(v) && v !== norm(value)) onCommit(v) }}
        onBlur={() => { if (txt !== norm(value)) onCommit(txt || null) }} />
    </div>
  )
}
