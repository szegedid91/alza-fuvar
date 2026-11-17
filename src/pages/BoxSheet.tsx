import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday, todayIsBox } from '../hooks/useToday'
import { useAlzaBoxes } from '../hooks/useAlzaBoxes'
import RequireCheckin from '../components/RequireCheckin'
import StopPhotos, { type StopPhotosHandle } from '../components/StopPhotos'
import StopItems, { type StopItem } from '../components/StopItems'
import { BoxIssueButton } from '../components/BoxIssue'
import InspectionGate from '../components/InspectionGate'
import ConfirmButton from '../components/ConfirmButton'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'
import { resolveNames } from '../lib/names'
import { formatDate } from '../lib/labels'
import { toast } from '../lib/toast'
import {
  STOP_FIELDS, COMP_FIELDS, RET_FIELDS, WH_FIELDS, stopTotals, searchBoxes, isBoxCode, hhmmOfISO, missedStops, stopMessageLines, stopInRound,
  type BoxSheet, type BoxStop, type AlzaBox,
} from '../lib/boxSheet'
import type { Car } from '../lib/checkin'
import { useTodayStatusEvents } from '../lib/statusEvents'
import { errMsg } from '../lib/errors'
import { submitNow } from '../lib/outbox'
import { useQueuedLoaded } from '../hooks/useOutbox'
import { isStopFilled, mergeQueuedStops } from '../lib/queuedMerge'
import { openNav, shouldNavAfterFill, canFinishRouteFromSheet, requestNavPrompt, type AfterFill } from '../lib/nav'
import { openWhatsApp, statusText } from '../lib/groupMessage'
import { lateMinutes } from '../lib/routePlan'
import { useMyRoutesToday } from '../hooks/useMyRoutesToday'
import { useRouteStops } from '../hooks/useRouteStops'
import { useRoutes } from '../hooks/useRoutes'

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
      {/* Autó lerakva (a nap lezárva): a mai Box-lapok már csak megtekinthetők — szerkeszteni nem lehet.
          Korábbi nap lapja a futárnak nem érhető el: ez az oldal mindig csak a mai lapot nyitja. */}
      <RequireCheckin>{({ car, date, checkin }) => {
        const closed = !!checkin.checked_out_at
        return <InspectionGate carId={car.id} date={date}><DepartedGate closed={closed}><CrewSheet car={car} date={date} closed={closed} /></DepartedGate></InspectionGate>
      }}</RequireCheckin>
    </div>
  )
}

// A Box-lap csak a „Kiindultam” jelzés után tölthető: a lap a járat közbeni munkát rögzíti,
// kiindulás előtt nincs mit beírni (és a lap sem jön létre idő előtt)
function DepartedGate({ children, closed = false }: { children: React.ReactNode; closed?: boolean }) {
  const { data: events, isLoading } = useTodayStatusEvents()
  const [sp] = useSearchParams()
  // lezárt nap: nincs kapu és nincs „javítás” megjegyzés — a lap csak megtekinthető
  if (closed) return <>{children}</>
  if (isLoading && !events) return <Skeleton rows={3} />
  const departed = (events ?? []).some((e) => e.kind === 'departed')
  // a box előtti kitöltő képernyőn nincs megjegyzés — az csak az áttekintésnél kell
  const anyDone = (events ?? []).some((e) => e.kind === 'done') && !sp.get('box')
  if (departed) return (
    <>
      {anyDone && <div className="tiny muted"><Icon name="pencil" size={12} style={{ verticalAlign: -2 }} /> A javításokat a vezetők látják.</div>}
      {children}
    </>
  )
  return (
    <div className="card stack" style={{ borderColor: 'var(--warning)' }}>
      <div className="row"><Icon name="lock" size={24} style={{ color: 'var(--warning)' }} /><strong>A Box-lap a „Kiindultam” után tölthető</strong></div>
      <p className="small muted" style={{ margin: 0 }}>Előbb a kezdőlapon jelezd a kiindulást („Kiindultam”), utána a járat-kártyáról minden boxnál kitöltheted a lapot.</p>
      <Link to="/" className="btn" style={{ textDecoration: 'none' }}><Icon name="home" />Kezdőlap</Link>
    </div>
  )
}

function CrewSheet({ car, date, closed = false }: { car: Car; date: string; closed?: boolean }) {
  const { profile } = useAuth()
  // A járat-kártyáról érkezve (?box=<id>) az aktuális box megállója automatikusan felkerül a lapra
  const [params] = useSearchParams()
  const prefillBox = closed ? null : params.get('box')
  // a járat-kártyáról jön a box sorszáma is (n/of) — a lapon és a csoportüzenetben látszik
  const n = params.get('n'), of = params.get('of')
  const seqLabel = n && of ? `${n}/${of}` : null
  const { currentWorkspaceId } = useWorkspace()
  const { data: today } = useToday()
  const category = today?.car?.category ?? null
  const needsSheet = todayIsBox(today)

  // A mai lap: ha még nincs, létrehozzuk (egy ember – egy nap – egy lap)
  const sheetQ = useQuery({
    queryKey: ['box-sheet-today', currentWorkspaceId, profile?.id, date],
    enabled: needsSheet && !!currentWorkspaceId && !!profile,
    queryFn: async () => {
      const { data, error } = await supabase.from('box_sheets').select('id')
        .eq('workspace_id', currentWorkspaceId!).eq('user_id', profile!.id).eq('work_date', date).maybeSingle()
      if (error) throw error
      if (data) return data.id
      if (closed) return null // lezárt napon nem hozunk létre lapot — ha nem volt, nincs mit megnézni
      const { data: ins, error: e2 } = await supabase.from('box_sheets')
        .insert({ workspace_id: currentWorkspaceId!, user_id: profile!.id, car_id: car.id, work_date: date }).select('id').single()
      if (e2) {
        // LOG-19: két fül / párhuzamos mount — a másik már létrehozta (UNIQUE): azt vesszük át
        if (e2.code === '23505') {
          const { data: again, error: e3 } = await supabase.from('box_sheets').select('id')
            .eq('workspace_id', currentWorkspaceId!).eq('user_id', profile!.id).eq('work_date', date).maybeSingle()
          if (e3) throw e3
          if (again) return again.id
        }
        throw e2
      }
      return ins.id
    },
    retry: false, // a queryFn ír is — ne ismételje gépiesen
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
  if (closed && !sheetQ.isError && !sheetQ.data) return <div className="empty"><span className="ico"><Icon name="package" size={40} /></span>Ma nem volt kitöltött Box-lap.</div>
  if (sheetQ.isError || !sheetQ.data) {
    return <div className="alert error">Nem sikerült megnyitni a mai lapot: {errMsg(sheetQ.error, '')}</div>
  }
  return <SheetEditor sheetId={sheetQ.data} prefillBoxId={prefillBox} prefillSince={prefillBox ? params.get('since') : null} seqLabel={seqLabel} readOnly={closed} />
}

type SheetRow = BoxSheet & { car: { plate: string } | null }

// A nap végi raktári mezők (raktári problémák, raktárban leadott) és a „Komplikációk” kártya EGYELŐRE
// nem látszik — sem a futárnál, sem a vezetői nézetben. Az adat és az oszlopok megmaradnak; visszakapcsolás: true.
const DAY_END_FIELDS: boolean = false

// readOnly: a futár lezárt napja (autó lerakva) — a lap csak megtekinthető: nincs mező, hozzáadás, törlés, lezárás
// prefillSince: a mostani kör „Kiindultam” ideje — ugyanaz a box a 2. körben új sort kap
export function SheetEditor({ sheetId, managerView = false, prefillBoxId = null, prefillSince = null, seqLabel = null, readOnly = false }: { sheetId: string; managerView?: boolean; prefillBoxId?: string | null; prefillSince?: string | null; seqLabel?: string | null; readOnly?: boolean }) {
  const qc = useQueryClient()
  const { profile } = useAuth()
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
      // a saját lapnál a név megvan a profilból — nem kell érte külön kör a szerverhez
      const names: Record<string, string | null> = sheet.user_id === profile?.id ? { [sheet.user_id]: profile.full_name ?? profile.email ?? null } : await resolveNames([sheet.user_id])
      return { sheet: sheet as unknown as SheetRow, stops: (stops ?? []) as BoxStop[], name: names[sheet.user_id] ?? null }
    },
  })

  // A lap összes csomag-eltérése EGY lekérdezéssel (megállónként csoportosítva) — korábban megállónként ment egy,
  // ami 10–15 boxnál ugyanennyi kérés volt minden megnyitáskor
  const { data: itemsByStop } = useQuery({
    queryKey: ['stop-items', 'sheet', sheetId],
    queryFn: async () => {
      const { data, error } = await supabase.from('box_stop_items')
        .select('id, stop_id, kind, package_code, note, return_to_depot, created_at, photos:box_stop_item_photos(id, storage_path), stop:box_sheet_stops!inner(sheet_id)')
        .eq('stop.sheet_id', sheetId).order('created_at')
      if (error) throw error
      const m: Record<string, StopItem[]> = {}
      for (const r of (data ?? []) as unknown as (StopItem & { stop_id: string })[]) (m[r.stop_id] ??= []).push(r)
      return m
    },
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['box-sheet', sheetId] })
    void qc.invalidateQueries({ queryKey: ['box-sheet-status'] })
    void qc.invalidateQueries({ queryKey: ['box-sheets'] })
  }
  // LOG-21: sikertelen mentés után a számmezők a szerver értékére állnak vissza (resetTick)
  const [resetTick, setResetTick] = useState(0)
  const fail = (e: unknown) => { setResetTick((t) => t + 1); toast.error(errMsg(e, 'A mentés nem sikerült')) }

  const updateSheet = useMutation({
    mutationFn: async (patch: Partial<BoxSheet>) => {
      const { error } = await supabase.from('box_sheets').update(patch).eq('id', sheetId)
      if (error) throw error
    },
    onSuccess: invalidate, onError: fail,
  })
  // Megálló felvétele AZONNAL: a sor a koppintásra megjelenik (kliens-oldali azonosítóval), a mentés a háttérben megy.
  // Korábban a mezők csak a beszúrás + a végzés-idő mentése + a lap újraolvasása után jelentek meg (lassú neten másodpercek).
  // A most felvett (még mentés alatt álló) megállók a komponens állapotában élnek, és a szerverről jött listához
  // fűzzük őket — így egy közben érkező frissítés (fókuszváltás, másik mentés) nem tünteti el a sort.
  const [pendingStops, setPendingStops] = useState<BoxStop[]>([])
  // …és a helyi sorban álló (térerő nélkül még fel nem küldött) felvételek és módosítások is ráolvadnak
  const { recs: queuedWrites, loaded: queuedLoaded } = useQueuedLoaded('box_sheet_stops')
  // a most beírt értékek azonnal látszanak (nem várunk a mentés visszaigazolására) — a mentés után a szerver értéke veszi át
  const [optimistic, setOptimistic] = useState<Record<string, Partial<BoxStop>>>({})
  const allStops = useMemo(() => {
    const server = data?.stops ?? []
    return mergeQueuedStops([...server, ...pendingStops.filter((p) => !server.some((st) => st.id === p.id))], queuedWrites, sheetId)
      .map((st) => (optimistic[st.id] ? { ...st, ...optimistic[st.id] } : st))
  }, [data, pendingStops, queuedWrites, sheetId, optimistic])
  // amikor a helyi sor kiürül (felment, ami sorban állt), a lapot újraolvassuk a szerverről
  useEffect(() => { void qc.invalidateQueries({ queryKey: ['box-sheet', sheetId] }) }, [queuedWrites.length, qc, sheetId])
  useEffect(() => {
    // amit a szerver már visszaadott, az nem függő többé
    if (pendingStops.length && data?.stops.some((st) => pendingStops.some((p) => p.id === st.id))) setPendingStops((prev) => prev.filter((p) => !data.stops.some((st) => st.id === p.id)))
  }, [data, pendingStops])
  const pendingInsert = useRef<Promise<unknown> | null>(null)
  const addStop = useMutation({
    mutationFn: async (v: { stop: BoxStop; hm: string }) => {
      const { stop } = v
      // A helyi soron át megy: térerő nélkül sorba áll, és kapcsolatnál felmegy (a kliens-azonosító miatt nem duplázódik)
      await submitNow({
        id: stop.id, table: 'box_sheet_stops', op: 'insert', label: `Box-lap: ${stop.box_code ?? 'megálló'}`,
        values: { id: stop.id, sheet_id: sheetId, workspace_id: stop.workspace_id, seq: stop.seq, done_at: stop.done_at, box_id: stop.box_id, box_code: stop.box_code, box_name: stop.box_name },
      })
      // A lap „végzés” ideje = az utolsó box ideje — a háttérben mentjük, a kitöltést nem tartja fel
      // LOG-20: a megálló már mentve — a végzés-idő hibája nem „sikertelen hozzáadás”
      void submitNow({ id: crypto.randomUUID(), table: 'box_sheets', op: 'update', match: { id: sheetId }, values: { end_time: v.hm }, label: 'Box-lap: végzés ideje' })
        .catch((e2) => toast.error('A megálló mentve, de a végzés ideje nem frissült: ' + errMsg(e2, 'ismeretlen hiba')))
    },
    onMutate: (v) => { setPendingStops((prev) => [...prev, v.stop]) },
    onError: (e, v) => { setPendingStops((prev) => prev.filter((st) => st.id !== v.stop.id)); prefilledRef.current = null; fail(e) },
    onSettled: invalidate,
  })
  const add = (box: AlzaBox | { code: string }) => {
    if (!data) return
    const now = new Date()
    const stop: BoxStop = {
      id: crypto.randomUUID(), sheet_id: sheetId, workspace_id: data.sheet.workspace_id,
      seq: allStops.reduce((m, st) => Math.max(m, st.seq), 0) + 1, done_at: now.toISOString(), created_at: now.toISOString(),
      box_id: 'id' in box ? box.id : null, box_code: 'id' in box ? box.code : box.code.toUpperCase(), box_name: 'id' in box ? box.name : null,
      placed: 0, missorted: 0, nf: 0, oversize: 0, shortage: 0, returned: 0, damaged: 0, invalid_code: 0, do_not_place: 0, cancelled: 0, left_on_car: 0, note: null,
    }
    const hm = now.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', hour12: false })
    // a mező-mentések megvárják, hogy a sor a szerveren is meglegyen (különben a gyorsan beírt szám elveszne)
    const p = addStop.mutateAsync({ stop, hm }).catch(() => undefined)
    pendingInsert.current = p
    void p.finally(() => { if (pendingInsert.current === p) pendingInsert.current = null })
  }
  const updateStop = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<BoxStop> }) => {
      if (pendingInsert.current) await pendingInsert.current // a most felvett sor előbb érjen a szerverre (vagy a sorba)
      // térerő nélkül sorba áll — a képernyő a sorban álló értéket mutatja, a beírt szám nem vész el
      const code = allStops.find((st) => st.id === id)?.box_code
      await submitNow({ id: crypto.randomUUID(), table: 'box_sheet_stops', op: 'update', match: { id }, values: patch as Record<string, unknown>, label: `Box-lap: ${code ?? 'megálló'} adatai` })
    },
    onMutate: ({ id, patch }) => { setOptimistic((o) => ({ ...o, [id]: { ...o[id], ...patch } })) },
    onError: fail,
    onSettled: async (_d, _e, { id, patch }) => {
      // előbb a lap frissül a szerverről, csak utána engedjük el a helyi értéket (közben ne ugorjon vissza a régi szám)
      await qc.invalidateQueries({ queryKey: ['box-sheet', sheetId] }).catch(() => undefined)
      setOptimistic((o) => {
        const cur: Record<string, unknown> = { ...(o[id] ?? {}) }
        for (const [k, v] of Object.entries(patch)) if (cur[k] === v) delete cur[k]
        const next = { ...o }
        if (Object.keys(cur).length) next[id] = cur as Partial<BoxStop>; else delete next[id]
        return next
      })
      invalidate()
    },
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
  // Végzés idő szerkesztése (egy soros kijelzés, koppintásra mező)
  const [editEnd, setEditEnd] = useState(false)
  // A futár saját lapja a járat-kártyán kívülről megnyitva: ÁTTEKINTÉS — minden box összecsukva, a szerkesztéshez
  // ki kell nyitni egyet; a kézi box-felvétel csak kérésre látszik
  const overview = !managerView && !prefillBoxId
  const [showAdd, setShowAdd] = useState(false)
  const [addedNow, setAddedNow] = useState(false)
  useEffect(() => {
    if (!prefillBoxId || !data || prefilledRef.current === prefillBoxId || addStop.isPending) return
    // a helyi (még fel nem küldött) mentések kiolvasásáig várunk: különben térerő nélkül újra megnyitva a boxot
    // a sorban álló sor mellé egy második, üres sor jönne létre (a beírt számok elveszettnek látszanának)
    if (!queuedLoaded) return
    // már a lapon van (ebben a körben): nincs teendő (a jelzőt NEM állítjuk be — ha egy frissítés után mégsem lenne ott, felvesszük)
    if (allStops.some((st) => st.box_id === prefillBoxId && stopInRound(st, prefillSince))) return
    const box = boxById.get(prefillBoxId)
    if (!box || data.sheet.status === 'submitted') return
    prefilledRef.current = prefillBoxId
    add(box)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillBoxId, data, boxById, queuedLoaded])

  if (isLoading) return <Skeleton rows={5} />
  if (isError || !data) return <div className="alert error">Nem sikerült betölteni a lapot: {errMsg(error, '')}</div>

  const { sheet, name } = data
  const stops = allStops
  const totals = stopTotals(stops)
  const submitted = sheet.status === 'submitted'
  const saving = updateSheet.isPending || updateStop.isPending || addStop.isPending || removeStop.isPending
  const dayEndVisible = !prefillBoxId && !readOnly
  const TOTALS = stops.length > 0 && !prefillBoxId ? (
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
  ) : null

  // A futár a box előtt áll: csak az aktuális box, egy képernyőn, egy fő gombbal
  if (prefillBoxId && !managerView) {
    // a mostani kör sora (ha a box az előző körben is szerepelt, annak a sora nem ez)
    const cur = [...stops].reverse().find((st) => st.box_id === prefillBoxId && stopInRound(st, prefillSince))
    if (!cur) return <Skeleton rows={4} />
    return (
      <FillStop stop={cur} box={cur.box_id ? boxById.get(cur.box_id) ?? null : null} courierName={name ?? 'Futár'} resetKey={resetTick}
        seqLabel={seqLabel} items={itemsByStop?.[cur.id]} onPatch={(patch) => updateStop.mutate({ id: cur.id, patch })} />
    )
  }

  return (
    <>
      {/* A lap fejléce (dátum, piszkozat, végzés) csak a vezetőnek — a futárnak nem kell */}
      {managerView && (
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
        {/* Végzés: egy sor — az idő automatikus (az utolsó box ideje), koppintásra javítható */}
        {editEnd ? (
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}><TimeField label="Végzés (box)" value={sheet.end_time} onCommit={(v) => updateSheet.mutate({ end_time: v })} /></div>
            <button type="button" className="btn ghost sm auto" onClick={() => setEditEnd(false)}>Kész</button>
          </div>
        ) : (
          <div className="tiny muted row" style={{ gap: 6 }}>
            <Icon name="clock" size={12} />Végzés: <span className="num" style={{ color: 'var(--text)' }}>{sheet.end_time ? sheet.end_time.slice(0, 5) : '—'}</span>
            <span>(automatikus)</span>
            {!submitted && <button type="button" className="link-btn tiny" style={{ padding: 0 }} onClick={() => setEditEnd(true)}>javítás</button>}
          </div>
        )}
      </div>
      )}

      {prefillBoxId && (
        <Link to="/" className="btn" style={{ textDecoration: 'none' }}>
          <Icon name="arrow-left" />Vissza a járathoz
        </Link>
      )}

      {readOnly && (
        <div className="alert info row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <Icon name="lock" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>A nap le van zárva (autó lerakva) — a mai Box-lapok már csak megtekinthetők. Ha valami hibás, szólj a vezetőnek.</span>
        </div>
      )}
      {overview && TOTALS}

      <div className="card stack" style={{ gap: 10 }}>
        <div className="between">
          <div className="card-title" style={{ margin: 0 }}><Icon name="package" />{prefillBoxId ? 'Aktuális box' : overview ? 'Mai Box-lapok' : 'Megállók'}</div>
          <span className="badge primary num">{stops.length} box</span>
        </div>
        {prefillBoxId
          ? <div className="tiny muted">Írd be a darabszámokat ehhez a boxhoz.</div>
          : overview
            ? <div className="tiny muted">{stops.length ? (readOnly ? 'Koppints egy boxra a részletekhez.' : 'Koppints egy boxra, ha meg akarod nézni vagy javítani.') : 'Ma még nincs kitöltött box.'}</div>
            : <AddStop onAdd={(b) => add(b)} busy={addStop.isPending} />}
        {stops.length === 0 && !prefillBoxId && !overview && <div className="tiny muted">Még nincs megálló — keresd meg a boxot kód vagy név alapján, és add hozzá.</div>}
        {[...stops].sort((a, b) => (a.box_id === prefillBoxId ? -1 : b.box_id === prefillBoxId ? 1 : 0)).map((s) => {
          const i = stops.findIndex((x) => x.id === s.id)
          const focus = !!prefillBoxId && s.box_id === prefillBoxId
          return (
            <StopRow key={s.id} stop={s} index={i + 1} isLast={!readOnly && !prefillBoxId && i === stops.length - 1 && (!overview || addedNow)} focus={focus} readOnly={readOnly} box={s.box_id ? boxById.get(s.box_id) ?? null : null} seqLabel={focus ? seqLabel : null} items={itemsByStop?.[s.id]}
              courierName={name ?? 'Futár'} resetKey={resetTick} onPatch={(patch) => updateStop.mutate({ id: s.id, patch })} onRemove={() => removeStop.mutate(s.id)} />
          )
        })}
        {overview && !readOnly && (showAdd
          ? <MissedAdd sheetBoxIds={stops.map((s) => s.box_id)} onAdd={(b) => { setAddedNow(true); add(b) }} busy={addStop.isPending} onClose={() => setShowAdd(false)} />
          : <button type="button" className="link-btn tiny" style={{ padding: 0, textAlign: 'left' }} onClick={() => setShowAdd(true)}><Icon name="plus" size={12} /> Kimaradt egy box? Hozzáadás</button>)}
      </div>

      {!overview && TOTALS}

      {DAY_END_FIELDS && dayEndVisible && (
      <div className="card stack" style={{ gap: 8 }}>
        <div className="tiny muted" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Nap vége — raktárba visszaérve</div>
        <div className="tiny muted">Ezeket a nap legvégén, a raktárba visszaérve töltsd ki, az egész napra összesítve.</div>
        <div className="card-title" style={{ margin: 0 }}><Icon name="alert-triangle" />Raktári problémák</div>
        <div className="grid-2">
          {WH_FIELDS.slice(0, 2).map((f) => <NumField key={f.key} label={f.label} value={sheet[f.key]} resetKey={resetTick} onCommit={(v) => updateSheet.mutate({ [f.key]: v })} />)}
        </div>
        <NumField label={WH_FIELDS[2].label} value={sheet.wh_pallet_items} resetKey={resetTick} onCommit={(v) => updateSheet.mutate({ wh_pallet_items: v })} />
        <TextField label={'Megjegyzés („MENT” stb.)'} value={sheet.wh_note ?? ''} onCommit={(v) => updateSheet.mutate({ wh_note: v || null })} />
        <div className="card-title" style={{ margin: 0, marginTop: 6 }}><Icon name="truck" />Raktárban leadott (db)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {RET_FIELDS.map((f) => <NumField key={f.key} label={f.label} value={sheet[f.key]} resetKey={resetTick} onCommit={(v) => updateSheet.mutate({ [f.key]: v })} />)}
        </div>
      </div>
      )}

      {DAY_END_FIELDS && dayEndVisible && (
      <div className="card stack" style={{ gap: 8 }}>
        <div className="card-title" style={{ margin: 0 }}><Icon name="wrench" />Komplikációk</div>
        <div className="grid-2">
          {COMP_FIELDS.map((f) => <NumField key={f.key} label={f.label} value={sheet[f.key]} resetKey={resetTick} onCommit={(v) => updateSheet.mutate({ [f.key]: v })} />)}
        </div>
        <TextField label="Egyéb" value={sheet.comp_note ?? ''} onCommit={(v) => updateSheet.mutate({ comp_note: v || null })} />
      </div>
      )}

      {dayEndVisible && (
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

// Kimaradt box felvétele az áttekintésben: a járat(ok) még ki nem töltött boxai EGY koppintással,
// alatta külön kereső más (nem a járathoz tartozó) boxhoz — kódra vagy névre.
function MissedAdd({ sheetBoxIds, onAdd, busy, onClose }: { sheetBoxIds: (string | null)[]; onAdd: (box: AlzaBox | { code: string }) => void; busy: boolean; onClose: () => void }) {
  const { data: myShifts } = useMyRoutesToday()
  const { data: stopsByRoute } = useRouteStops(myShifts ? myShifts.map((sh) => sh.route_id) : null)
  const { data: routes } = useRoutes()
  const shifts = myShifts ?? []
  const missed = useMemo(() => missedStops(shifts.map((sh) => stopsByRoute?.[sh.route_id] ?? []), sheetBoxIds), [shifts, stopsByRoute, sheetBoxIds])
  const total = missed.reduce((a, m) => a + m.length, 0)
  return (
    <div className="stack" style={{ gap: 10, padding: 10, border: '1px solid var(--primary)', borderRadius: 'var(--radius-sm)' }}>
      <div className="between">
        <span className="small" style={{ fontWeight: 800 }}><Icon name="plus" size={14} /> Kimaradt box hozzáadása</span>
        <button type="button" className="link-btn tiny" style={{ padding: 0 }} onClick={onClose}>bezárás</button>
      </div>
      {shifts.map((sh, i) => missed[i]?.length > 0 && (
        <div key={sh.id} className="stack" style={{ gap: 6 }}>
          <div className="tiny muted">{routes?.find((r) => r.id === sh.route_id)?.code ?? '?'} járat{shifts.length > 1 ? ` · ${sh.round}. kör` : ''} — koppints arra, amelyik kimaradt</div>
          <div className="list" style={{ gap: 6 }}>
            {missed[i].map(({ stop, n }) => (
              <button key={stop.id} type="button" className="list-item" disabled={busy} style={{ width: '100%', textAlign: 'left', cursor: 'pointer', padding: '8px 12px' }} onClick={() => onAdd(stop.box)}>
                <div className="row" style={{ gap: 8 }}>
                  <Icon name="plus" size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="small" style={{ fontWeight: 700 }}><span className="num">{n}. </span>{stop.box.code && <span className="num">{stop.box.code} · </span>}{stop.box.name}</div>
                    <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stop.box.address}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
      {shifts.length > 0 && total === 0 && <div className="tiny muted"><Icon name="check-circle" size={12} style={{ color: 'var(--success)' }} /> A járatod minden boxa szerepel a lapon.</div>}
      <div className="stack" style={{ gap: 6 }}>
        <div className="tiny muted">Más box (nem a járatodé) — kóddal</div>
        <AddStop onAdd={onAdd} busy={busy} placeholder="Más box: kód vagy név (AB9103…)" />
      </div>
    </div>
  )
}

// Megálló keresése a jegyzékben (kód / név) — kódra kézzel is felvehető
function AddStop({ onAdd, busy, placeholder = 'Box hozzáadása: kód vagy név (AB9103…)' }: { onAdd: (box: AlzaBox | { code: string }) => void; busy: boolean; placeholder?: string }) {
  const { data: boxes } = useAlzaBoxes()
  const [q, setQ] = useState('')
  const results = useMemo(() => searchBoxes(boxes ?? [], q, 6), [boxes, q])
  const trimmed = q.trim()
  const pick = (b: AlzaBox | { code: string }) => { onAdd(b); setQ('') }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="input-icon">
        <Icon name="search" />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoComplete="off"
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

// A box előtti kitöltő képernyő: fotó a kijelzőről (magától kiolvas) → „Behelyezett” → küldés a csoportba → kész.
// Az eltérések (a többi számláló, csomag-eltérés, megjegyzés) egy gomb mögött vannak — a legtöbb boxnál nem kellenek.
function FillStop({ stop, box, courierName, onPatch, resetKey = 0, seqLabel = null, items }: {
  stop: BoxStop; box: AlzaBox | null; courierName: string; onPatch: (patch: Partial<BoxStop>) => void
  resetKey?: number; seqLabel?: string | null; items?: StopItem[]
}) {
  const navigate = useNavigate()
  // a járat-kártyáról érkezve: a „Kész, következő box” utáni navigáció célja (a következő box koordinátája)
  const after = (useLocation().state as { after?: AfterFill | null } | null)?.after ?? null
  const photosRef = useRef<StopPhotosHandle>(null)
  // „elküldve a csoportba” — a készüléken jegyezzük (a fotók „küldve” jelölése mellett), hogy visszatérve is a „Kész” látsszon
  const sentKey = `box-sent:${stop.id}`
  const [sent, setSent] = useState(() => { try { return localStorage.getItem(sentKey) === '1' } catch { return false } })
  const markSent = () => { setSent(true); try { localStorage.setItem(sentKey, '1') } catch { /* nem kritikus */ } }
  const [sharing, setSharing] = useState(false)
  const extraFields = STOP_FIELDS.filter((f) => f.key !== 'placed')
  const extrasUsed = extraFields.some((f) => stop[f.key] > 0) || (items?.length ?? 0) > 0 || !!stop.note?.trim()
  const [more, setMore] = useState(extrasUsed)
  useEffect(() => { if (extrasUsed) setMore(true) }, [extrasUsed])
  const filled = isStopFilled(stop)
  const [n, of] = (seqLabel ?? '').split('/')
  const last = !!seqLabel && n === of
  const name = stop.box_name ?? box?.name ?? ''
  const placed = STOP_FIELDS.find((f) => f.key === 'placed')!
  // az utolsó boxnál a fő gomb „Járat kész” (ha késés-okot kell adni, az előbb a járat-kártyán történik)
  const lateDeps = { lateMin: (d: string | null) => lateMinutes(d, 1) }
  const routeFinish = last && canFinishRouteFromSheet(after, stop.box_id, lateDeps)

  async function send() {
    setSharing(true)
    try { if ((await photosRef.current?.share()) === 'shared') markSent() } catch { /* a megosztás hibáját a fotó-rész jelzi */ } finally { setSharing(false) }
  }
  // Box-hiba: a bejelentés a megjegyzésbe kerül (így a box kitöltöttnek számít), és az üzenete már ment a csoportba
  function issueReported(kindLabel: string, note: string) {
    const tag = `Box-hiba: ${kindLabel}${note ? ` — ${note}` : ''}`
    if (!(stop.note ?? '').includes(tag)) onPatch({ note: [stop.note?.trim(), tag].filter(Boolean).join(' · ') })
    markSent()
  }

  return (
    <div className="card stack" style={{ gap: 12, borderColor: 'var(--primary)' }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 18 }}>
          {seqLabel && <span className="badge primary num" style={{ marginRight: 6, verticalAlign: 'middle' }}>{seqLabel}</span>}
          {stop.box_code ? `${stop.box_code} · ` : ''}{name}
        </div>
        {box?.address && <div className="small muted">{box.address}</div>}
      </div>

      <StopPhotos ref={photosRef} fill stop={stop} boxLabel={`${stop.box_code ? stop.box_code + ' · ' : ''}${name}`} boxAddress={box?.address ?? null}
        courierName={courierName} onPatch={onPatch} items={items ?? []} seqLabel={seqLabel} onSent={markSent} />

      <NumField big label="Behelyezett csomag (db)" value={stop.placed} resetKey={resetKey} onCommit={(v) => onPatch({ [placed.key]: v })} highlight />

      {!more ? (
        <button type="button" className="btn ghost" onClick={() => setMore(true)}>
          <Icon name="alert-triangle" size={16} />Volt eltérés? (hiány, NF, sérült csomag…)
        </button>
      ) : (
        <div className="stack" style={{ gap: 8, padding: 10, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
          <div className="between">
            <span className="small" style={{ fontWeight: 700 }}><Icon name="alert-triangle" size={14} /> Eltérések</span>
            {!extrasUsed && <button type="button" className="link-btn tiny" style={{ padding: 0 }} onClick={() => setMore(false)}>bezárás</button>}
          </div>
          <div className="grid-2">
            {extraFields.map((f) => <NumField key={f.key} label={f.label} value={stop[f.key]} resetKey={resetKey} onCommit={(v) => onPatch({ [f.key]: v })} />)}
          </div>
          <StopItems stopId={stop.id} items={items ?? []} />
          <TextField label="Megjegyzés" value={stop.note ?? ''} placeholder="pl. +1 talált csomag" onCommit={(v) => onPatch({ note: v || null })} />
        </div>
      )}

      <BoxIssueButton box={{ id: stop.box_id, code: stop.box_code, name: name || null }} stopId={stop.id} courierName={courierName} onReported={issueReported} />

      {/* A fő gomb: előbb küldés a csoportba, utána kész */}
      {!sent ? (
        <>
          <button type="button" className="btn" style={{ minHeight: 60, fontSize: 17 }} disabled={!filled || sharing} onClick={() => void send()}>
            <Icon name="send" />{sharing ? 'Megosztás…' : 'Küldés a csoportba'}
          </button>
          {!filled
            ? <div className="tiny muted" style={{ textAlign: 'center' }}>Előbb fotózd le a kijelzőt, vagy írd be a behelyezett darabszámot.</div>
            : <button type="button" className="link-btn tiny" style={{ alignSelf: 'center' }} onClick={markSent}>tovább küldés nélkül</button>}
        </>
      ) : (
        <>
          <button type="button" className="btn" style={{ minHeight: 60, fontSize: 17 }} disabled={!filled} onClick={() => {
            // Utolsó box: ez a gomb maga a „Járat kész” — a WhatsApp a kész üzenettel nyílik (a koppintáson belül),
            // a járat-kártya lezárja a járatot és rögzíti a jelzést, visszaváltva pedig a raktárba indul a navigáció
            if (routeFinish && after) {
              const at = new Date()
              navigate('/', { state: { finishBox: stop.box_id, routeDoneAt: at.toISOString() } })
              if (after.depot) requestNavPrompt(after.depot)
              openWhatsApp(statusText('done', at, courierName, after.routeCode ?? null))
              return
            }
            // a navigáció a koppintáson belül nyílik (különben a telefon rákérdezne); a box lezárását a járat-kártya végzi
            const nav = last ? null : shouldNavAfterFill(after, stop.box_id, lateDeps)
            navigate('/', { state: { finishBox: stop.box_id } })
            openNav(nav)
          }}>
            <Icon name={last ? 'flag' : 'check'} />{routeFinish ? 'Járat kész' : last ? 'Kész — vissza a járathoz' : 'Kész, következő box'}
          </button>
          {!filled && <div className="tiny muted" style={{ textAlign: 'center' }}>Írd be a behelyezett darabszámot.</div>}
          <button type="button" className="link-btn tiny" style={{ alignSelf: 'center' }} disabled={sharing} onClick={() => void send()}>újraküldés a csoportba</button>
        </>
      )}
    </div>
  )
}

function StopRow({ stop, index, isLast, focus = false, box, courierName, onPatch, onRemove, resetKey = 0, seqLabel = null, items, readOnly = false }: {
  stop: BoxStop; index: number; isLast: boolean; focus?: boolean; box: AlzaBox | null; courierName: string
  onPatch: (patch: Partial<BoxStop>) => void; onRemove: () => void; resetKey?: number; seqLabel?: string | null; items?: StopItem[]
  // lezárt napon: kinyitva csak a számok, a fotók és a megjegyzés látszik — szerkeszteni nem lehet
  readOnly?: boolean
}) {
  // Az újonnan felvett (utolsó, még üres) megálló nyitva — a többi összecsukva,
  // hogy 10-20 boxnál is áttekinthető maradjon a lap. Járat-módban a kijelölt box nyitva.
  const [open, setOpen] = useState(focus || (isLast && stop.placed === 0 && !stop.note))
  useEffect(() => { if (!isLast && !focus) setOpen(false) }, [isLast, focus])
  useEffect(() => { if (focus) setOpen(true) }, [focus])
  const extras = STOP_FIELDS.filter((f) => f.key !== 'placed' && stop[f.key] > 0)
  const flagged = stop.shortage > 0 || stop.invalid_code > 0 || stop.do_not_place > 0 || stop.cancelled > 0 || stop.damaged > 0 || stop.left_on_car > 0 || (items?.length ?? 0) > 0
  return (
    <div className="stack" style={{ gap: 8, padding: 10, border: focus ? '2px solid var(--primary)' : `1px solid ${flagged ? 'var(--warning)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', background: focus ? 'var(--primary-ghost)' : undefined }}>
      <button type="button" className="between" style={{ background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', gap: 8 }} onClick={() => setOpen((o) => !o)}>
        <div style={{ minWidth: 0 }}>
          <div className="small" style={{ fontWeight: 800 }}>
            <span className="muted">{seqLabel ? `${seqLabel}.` : `${index}.`}</span> <span className="num">{stop.box_code ?? '—'}</span>
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
      {!open && (items?.length ?? 0) > 0 && <div className="tiny muted">{items!.length} csomag-eltérés</div>}
      {!open && stop.note && <div className="tiny muted">{stop.note}</div>}
      {open && readOnly && (
        <>
          <StopPhotos readOnly stop={stop} boxLabel="" courierName={courierName} onPatch={() => undefined} />
          <div className="stack" style={{ gap: 2 }}>
            {stopMessageLines(stop).map((line) => <div key={line} className="small">{line}</div>)}
          </div>
          {(items?.length ?? 0) > 0 && <StopItems stopId={stop.id} items={items ?? []} readOnly />}
          {stop.note && <div className="small"><span className="muted">Megjegyzés: </span>{stop.note}</div>}
        </>
      )}
      {open && !readOnly && (
        <>
          {/* Fotó a box kijelzőjéről LEGFELÜL — egyből elérhető, nem kell a számok alá görgetni */}
          <StopPhotos stop={stop} boxLabel={`${stop.box_code ? stop.box_code + ' · ' : ''}${stop.box_name ?? box?.name ?? ''}`} boxAddress={box?.address ?? null} courierName={courierName} onPatch={onPatch} items={items ?? []} seqLabel={seqLabel} />
          <div className="grid-2">
            {STOP_FIELDS.map((f) => (
              <NumField key={f.key} label={f.label} value={stop[f.key]} resetKey={resetKey} onCommit={(v) => onPatch({ [f.key]: v })} highlight={f.key === 'placed'} autoFocus={f.key === 'placed' && (focus || isLast) && stop.placed === 0} />
            ))}
          </div>
          <StopItems stopId={stop.id} items={items ?? []} />
          <TextField label="Komplikáció / megjegyzés" value={stop.note ?? ''} placeholder="pl. +1 talált csomag" onCommit={(v) => onPatch({ note: v || null })} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <BoxIssueButton box={{ id: stop.box_id, code: stop.box_code, name: stop.box_name ?? box?.name ?? null }} stopId={stop.id} courierName={courierName} />
            {/* a járat aktuális boxát nem lehet levenni a lapról — a törlés csak a kézzel felvett megállókhoz kell */}
            {!focus && (
              <ConfirmButton className="btn ghost sm auto" confirmLabel="Törlés?" onConfirm={onRemove}>
                <Icon name="trash" size={16} />Megálló törlése
              </ConfirmButton>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// Számmező: szerkesztés közben helyi szöveg, elhagyáskor (blur) ment — így egy
// koppintás-sorozat nem indít mentést minden karakterre.
function NumField({ label, value, onCommit, highlight = false, autoFocus = false, resetKey = 0, big = false }: { label: string; value: number; onCommit: (v: number) => void; highlight?: boolean; autoFocus?: boolean; resetKey?: number; big?: boolean }) {
  const [txt, setTxt] = useState(String(value))
  // resetKey: sikertelen mentés után a beírt (nem mentett) szám helyett a szerver értéke látszik (LOG-21)
  useEffect(() => { setTxt(String(value)) }, [value, resetKey])
  return (
    <div className="field">
      <label>{label}</label>
      <input className="input num" inputMode="numeric" pattern="[0-9]*" value={txt} autoFocus={autoFocus}
        style={{ ...(highlight ? { borderColor: 'var(--primary)' } : {}), ...(big ? { fontSize: 28, fontWeight: 800, minHeight: 64, textAlign: 'center' } : {}) }}
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
