import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useRoutes } from '../hooks/useRoutes'
import { useToday } from '../hooks/useToday'
import { useRouteStops, type RouteStop } from '../hooks/useRouteStops'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { useWorkDay } from '../hooks/useWorkDay'
import { workDayISO } from '../lib/workDay'
import { getNavApp, navUrl, navTargetOf, openNav, launchNav, navPromptPending, clearNavPrompt, requestNavPrompt, PROMPT_EVENT, NAV_LABEL, type NavApp, type AfterFill } from '../lib/nav'
import { depotOf, type Depot } from '../lib/depot'
import { lateMinutes, resolveRunIndex, planTime } from '../lib/routePlan'
import { toast } from '../lib/toast'
import { Link, useLocation, useNavigate } from 'react-router'
import Icon from './Icon'
import BoxCard from './BoxCard'
import NavPromptOverlay from './NavPromptOverlay'
import { errMsg } from '../lib/errors'
import { recordStatusEvent, useTodayStatusEvents } from '../lib/statusEvents'
import { useMyRoutesToday } from '../hooks/useMyRoutesToday'
import { roundStates } from '../lib/rounds'
import { statusText, openWhatsApp } from '../lib/groupMessage'
import { submitNow } from '../lib/outbox'
import { useQueued } from '../hooks/useOutbox'
import { isStopFilled, mergeQueuedRuns, mergeQueuedStops, type RunRow } from '../lib/queuedMerge'
import { stopInRound, type BoxStop } from '../lib/boxSheet'

// A futár mai járata(i): a beosztásban hozzárendelt járat boxai sorrendben,
// „hanyadik cím” számlálóval, egy koppintásos navigációval (Google Maps / Waze —
// a választás a telefonon marad). A haladás az adatbázisban van (autó + járat +
// kör + nap), így másik telefonról / a páros másik tagjánál is ugyanott tart.
// active: a „Kiindultam” jelzés után — addig a járat csak megtekinthető (címek, navigálás), a leadás nem
export default function RouteCard({ active = true }: { active?: boolean }) {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const qc = useQueryClient()
  const date = useWorkDay()
  const depot = depotOf(currentWorkspace)
  const { data: routes } = useRoutes()
  const { data: stopsByRoute } = useRouteStops()
  const navApp: NavApp = getNavApp()
  const { data: today } = useToday()
  const needsBoxSheet = !!today?.car?.category?.box_sheet
  // A vezető módosítása (boxok, sorrend) és a páros másik tagjának lépése azonnal ideér
  useRealtimeInvalidate(currentWorkspaceId, ['route_stops', 'route_runs', 'shifts', 'box_sheet_stops'], [['route-stops'], ['route-runs'], ['my-routes-today'], ['box-sheet-filled']])
  const navigate = useNavigate()
  const location = useLocation()
  // a Box-lap „Kész, következő” gombjáról érkezve: ezt a boxot kell lezárni és továbblépni (a lap ott már ki volt töltve)
  const finishBox = (location.state as { finishBox?: string } | null)?.finishBox ?? null
  // az utolsó boxnál a Box-lap gombja maga a „Járat kész” volt (a WhatsApp ott már megnyílt): itt csak a lezárás és a rögzítés jön
  const routeDoneAt = (location.state as { routeDoneAt?: string } | null)?.routeDoneAt ?? null
  const [openList, setOpenList] = useState(false)

  const { data: myShifts } = useMyRoutesToday()
  // a körök állapota a mai jelzésekből: a lezárt kör összecsukva, a következő előkészítve
  const { data: todayStatus } = useTodayStatusEvents()
  const { data: serverRuns } = useQuery({
    queryKey: ['route-runs', currentWorkspaceId, date],
    enabled: !!currentWorkspaceId && (myShifts?.length ?? 0) > 0,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.from('route_runs').select('route_id, round, car_id, current_index, current_stop_id, current_box_id')
        .eq('workspace_id', currentWorkspaceId!).eq('work_date', date)
      if (error) throw error
      return (data ?? []) as RunRow[]
    },
  })
  // a sorban álló (térerő nélkül még fel nem küldött) léptetések ráolvadnak — a kártya ott áll, ahol a futár tart
  const queuedRuns = useQueued('route_runs')
  const runs = useMemo(() => (serverRuns || queuedRuns.length ? mergeQueuedRuns(serverRuns ?? [], queuedRuns, date) : undefined), [serverRuns, queuedRuns, date])
  // A mai Box-lapomon kitöltött boxok: a kártyán jelezzük, melyik boxhoz van már sor (a lap csak eltérésnél kell)
  const { data: sheetStops } = useQuery({
    queryKey: ['box-sheet-filled', currentWorkspaceId, profile?.id, date],
    enabled: !!currentWorkspaceId && !!profile?.id,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.from('box_sheet_stops')
        .select('id, box_id, done_at, created_at, placed, missorted, nf, oversize, shortage, returned, damaged, invalid_code, do_not_place, cancelled, left_on_car, note, sheet:box_sheets!inner(user_id, work_date)')
        .eq('workspace_id', currentWorkspaceId!).eq('sheet.user_id', profile!.id).eq('sheet.work_date', date)
      if (error) throw error
      return (data ?? []) as unknown as BoxStop[]
    },
  })
  // a sorban álló kitöltések is számítanak (térerő nélkül is tovább lehessen lépni)
  const queuedStops = useQueued('box_sheet_stops')
  // a mostani kör kezdete (az utolsó „Kiindultam”): csak az azóta kitöltött sorok számítanak — ha ugyanaz a box
  // az előző körben is szerepelt, itt újra ki kell tölteni (új sorba)
  const roundSince = useMemo(() => (todayStatus ?? []).filter((e) => e.kind === 'departed').map((e) => e.at).sort().pop() ?? null, [todayStatus])
  const filledBoxes = useMemo(() => mergeQueuedStops(sheetStops ?? [], queuedStops, null).filter(isStopFilled).filter((r) => stopInRound(r, roundSince)).map((r) => r.box_id).filter((x): x is string => !!x), [sheetStops, queuedStops, roundSince])
  // amikor a helyi sor kiürül (felment, ami sorban állt), a szerver adatait újraolvassuk
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['route-runs'] }); void qc.invalidateQueries({ queryKey: ['box-sheet-filled'] })
  }, [queuedRuns.length, queuedStops.length, qc])
  const setIndex = useMutation({
    mutationFn: async ({ routeId, round, carId, index, stopId, boxId, done, afterSaved }: { routeId: string; round: number; carId: string; index: number; stopId?: string | null; boxId?: string | null; done?: { boxId: string; stopIndex: number; lateMinutes?: number; delayReason?: string }[]; afterSaved?: () => void }) => {
      // A helyi soron át megy: térerő nélkül sorba áll (a kártya a sorban álló állást mutatja), kapcsolatnál felmegy
      await submitNow({
        id: crypto.randomUUID(), table: 'route_runs', op: 'insert', onConflict: 'work_date,route_id,round,car_id', label: 'Járat: léptetés',
        values: { workspace_id: currentWorkspaceId!, work_date: date, route_id: routeId, round, car_id: carId, current_index: index, current_stop_id: stopId ?? null, current_box_id: boxId ?? null, updated_by: profile!.id, updated_at: new Date().toISOString() },
      })
      // Előre lépéskor naplózzuk: ebben a boxban ekkor adott le mindent a futár (a vezető az Áttekintésben látja);
      // egy megálló egyszer naplózódik (ha a sofőr és a rakodó egyszerre nyomja, nem dupláz)
      for (const d of done ?? []) {
        await submitNow({
          id: crypto.randomUUID(), table: 'route_stop_logs', op: 'insert', onConflict: 'work_date,route_id,round,car_id,stop_index', ignoreDuplicates: true, label: 'Járat: box leadva',
          values: { workspace_id: currentWorkspaceId!, work_date: date, route_id: routeId, round, car_id: carId, user_id: profile!.id, box_id: d.boxId, stop_index: d.stopIndex, late_minutes: d.lateMinutes ?? null, delay_reason: d.delayReason ?? null },
        })
      }
      // LOG-06: a „Járat kész” jelzés csak SIKERES mentés után rögzül — de ITT, a mentésen belül (nem a kártya
      // visszahívásában): az utolsó boxnál a kártya eltűnhet, mire a mentés visszaér, és a jelzés elveszne
      afterSaved?.()
    },
    // Azonnali léptetés: a kártya a koppintásra rögtön a következő boxra vált, a mentés a háttérben megy
    // (eddig két írás + egy újraolvasás után váltott — gyenge térerőn ez másodpercek). Hiba esetén visszaáll.
    onMutate: async (v) => {
      const key = ['route-runs', currentWorkspaceId, date]
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<RunRow[]>(key)
      const row: RunRow = { route_id: v.routeId, round: v.round, car_id: v.carId, current_index: v.index, current_stop_id: v.stopId ?? null, current_box_id: v.boxId ?? null }
      const same = (r: RunRow) => r.route_id === v.routeId && r.round === v.round && r.car_id === v.carId
      qc.setQueryData<RunRow[]>(key, (old) => ((old ?? []).some(same) ? (old ?? []).map((r) => (same(r) ? row : r)) : [...(old ?? []), row]))
      return { key, prev }
    },
    onError: (e, _v, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.prev)
      toast.error('Nem sikerült menteni — visszaálltunk az előző boxra: ' + (errMsg(e, 'ismeretlen hiba')))
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['route-runs'] }),
  })

  if (!myShifts || myShifts.length === 0) return null
  const codeOf = (id: string) => routes?.find((r) => r.id === id)?.code ?? '?'
  const states = roundStates(myShifts.length, todayStatus ?? [])
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })

  return (
    <>
      {myShifts.map((sh, i) => {
        const stops = stopsByRoute?.[sh.route_id] ?? []
        const state = states[i]
        const roundLabel = `${codeOf(sh.route_id)} járat${myShifts.length > 1 ? ` · ${sh.round}. kör` : ''}`
        // lezárt kör: egy sor, összecsukva — a részletek már nem kellenek
        if (state.status === 'completed') {
          return (
            <div key={sh.id} className="card between" style={{ gap: 8, opacity: 0.8 }}>
              <div className="row" style={{ gap: 8, minWidth: 0 }}>
                <Icon name="check-circle" size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 700 }}>{roundLabel} — kész</div>
                  <div className="tiny muted">{state.doneAt ? `járat kész ${hhmm(state.doneAt)}` : ''}{state.settledAt ? ` · elszámolva ${hhmm(state.settledAt)}` : ' · elszámolás nélkül továbbindulva'}</div>
                </div>
              </div>
              <span className="badge num">{sh.plate}</span>
            </div>
          )
        }
        // kész kör, már a raktárban („Megérkeztem” a „Járat kész” után): csak egy sor — a navigálás a raktárba már nem kell
        const arrivedBack = !!state.doneAt && (todayStatus ?? []).some((e) => e.kind === 'arrived' && e.at > state.doneAt!)
        if (state.status === 'current' && arrivedBack) {
          return (
            <div key={sh.id} className="card between" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8, minWidth: 0 }}>
                <Icon name="check-circle" size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 700 }}>{roundLabel} — kész, a raktárban</div>
                  <div className="tiny muted">járat kész {hhmm(state.doneAt!)} · most: „Elszámoltam” a visszáruval</div>
                </div>
              </div>
              <span className="badge num">{sh.plate}</span>
            </div>
          )
        }
        // következő kör: amíg az előző tart, csak egy sor — a teljes kártya az előző lezárása után nyílik
        if (state.status === 'upcoming') {
          return (
            <div key={sh.id} className="card between" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8, minWidth: 0 }}>
                <Icon name="clock" size={18} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 700 }}>{roundLabel} — következik</div>
                  <div className="tiny muted">{stops.length} cím</div>
                </div>
              </div>
              <span className="badge num">{sh.plate}</span>
            </div>
          )
        }
        const run = runs?.find((r) => r.route_id === sh.route_id && r.round === sh.round && r.car_id === sh.car_id)
        const idx = resolveRunIndex(run, stops)
        const go = (index: number, late?: { minutes: number; reason: string }, afterSaved?: () => void) => {
          // ami az aktuális és az új hely között van, az leadva (általában egy box)
          const done: { boxId: string; stopIndex: number; lateMinutes?: number; delayReason?: string }[] = index > idx ? stops.slice(idx, index).map((s, k) => ({ boxId: s.box_id, stopIndex: idx + k + 1 })) : []
          // a késés oka az aktuális (utolsóként leadott) boxhoz tartozik — a vezetők pusht kapnak róla
          if (late && done.length) done[done.length - 1] = { ...done[done.length - 1], lateMinutes: late.minutes, delayReason: late.reason }
          // LOG-06: a „Járat kész” jelzés (done esemény) csak SIKERES mentés után rögzül
          setIndex.mutate({ routeId: sh.route_id, round: sh.round, carId: sh.car_id, index, stopId: stops[index]?.id ?? null, boxId: stops[index]?.box_id ?? null, done, afterSaved })
        }
        // Az utolsó boxnál a „Járat kész”: ugyanaz, mint a jelzés-kártya gombja — a WhatsApp a kész
        // szöveggel nyílik (a koppintáson belül), a jelzés rögzül (idő, GPS)
        // A WhatsApp a koppintáson belül nyílik (különben a böngésző blokkolja); a jelzés rögzítése
        // a leadás sikeres mentése után történik (LOG-06) — ha a mentés elhasal, nincs „kész” esemény.
        // pre: a jelzés a Box-lapon már elment (WhatsApp megnyitva, raktár-navigáció kérve) — itt csak a rögzítés, azzal az idővel
        const onRouteDone = (pre?: Date) => {
          if (!currentWorkspaceId || !profile) return
          const at = pre ?? new Date()
          if (!pre) {
            const name = profile.full_name || profile.email || 'Munkatárs'
            const text = statusText('done', at, name, codeOf(sh.route_id))
            // visszaváltáskor: „Navigáció indítása” a raktárba (egy koppintásból csak egy app nyílhat)
            requestNavPrompt({ lat: depot.lat, lng: depot.lng, title: depot.name, address: depot.address })
            openWhatsApp(text) // ugyanazon a lapon: visszaváltáskor az app van elöl, nem egy üres fül
          }
          return () => {
            void recordStatusEvent({ workspaceId: currentWorkspaceId, userId: profile.id, carId: sh.car_id, kind: 'done', at, geofence: currentWorkspace })
              .then(() => qc.invalidateQueries({ queryKey: ['status-events'] }))
              .catch((e) => toast.error('A „Járat kész” jelzés rögzítése nem sikerült: ' + errMsg(e, 'ismeretlen hiba')))
          }
        }
        return (
          <RouteCardView key={sh.id} code={codeOf(sh.route_id)} round={sh.round} plate={sh.plate} stops={stops} idx={idx} busy={setIndex.isPending} locked={!active} hasNextRound={i < myShifts.length - 1}
            plannedStart={routes?.find((r) => r.id === sh.route_id)?.planned_start ?? null}
            go={go} onRouteDone={onRouteDone} navApp={navApp} openList={openList} setOpenList={setOpenList} depot={depot}
            sheetFilled={!!stops[idx] && (filledBoxes.includes(stops[idx].box_id) || stops[idx].box_id === finishBox)}
            autoFinishBox={finishBox} autoDoneAt={routeDoneAt} onAutoFinishHandled={() => navigate('/', { replace: true, state: null })}
            // Box-lap csak az AlzaBox-szállító (Box-kategóriás) autónál kötelező — XL-nél nincs lap, a leadás szabad
            // a Box-lap megkapja, hova kell utána navigálni (a „Kész, következő box” gombja a koppintáson belül indítja)
            onFillSheet={needsBoxSheet ? (after) => navigate(`/box-lap?box=${stops[idx]?.box_id ?? ''}&n=${idx + 1}&of=${stops.length}${roundSince ? `&since=${encodeURIComponent(roundSince)}` : ''}`, { state: { after } }) : undefined} />
        )
      })}
    </>
  )
}

// Gyakori késés-okok (egy koppintás); szabad szöveg is írható
const LATE_REASONS = ['Kamion késett a raktárba', 'Előző túra nem zárult le időben, késői indulás', 'Dugó / forgalom / útlezárás', 'Box hiba (nem nyílt, tele, kijelző)', 'Sok csomag, hosszabb töltés']

// A járat-kártya megjelenése (egy járat egy körön)
function RouteCardView({ code, round, plate, stops, idx, busy = false, locked = false, hasNextRound = false, plannedStart = null, go, onRouteDone, navApp, openList, setOpenList, depot, sheetFilled = true, onFillSheet, autoFinishBox = null, autoDoneAt = null, onAutoFinishHandled }: {
  code: string; round: number; plate: string; stops: RouteStop[]; idx: number; busy?: boolean
  // a betöltött terv: tervezett indulás (ebből derül ki, melyik körre szól), a fájl neve és a betöltés ideje
  plannedStart?: string | null
  // van még kör ma: a „kész” kártya a következő körre irányít, nem a nap végére
  hasNextRound?: boolean
  // az utolsó box leadásakor: „Járat kész” — a WhatsApp azonnal nyílik, a visszaadott
  // függvény a sikeres mentés után rögzíti a jelzést
  onRouteDone?: (pre?: Date) => (() => void) | undefined
  // locked: még nem küldte el a „Kiindultam”-ot — a leadás gombjai inaktívak
  locked?: boolean
  go: (index: number, late?: { minutes: number; reason: string }, afterSaved?: () => void) => void; navApp: NavApp; openList: boolean; setOpenList: (f: (o: boolean) => boolean) => void
  // A raktár: az utolsó box után ide navigál a futár (az admin állítja a Járatok oldalon)
  depot: Depot
  // Box-lap csak eltérésnél: a „Kész, következő” mindig mehet; ha ehhez a boxhoz már van sor a mai lapon, jelezzük
  sheetFilled?: boolean; onFillSheet?: (after: AfterFill | null) => void
  // a Box-lapról „Kész, következő”-vel érkezve: ezt a boxot magától lezárja és továbblép (az utolsó boxnál nem — ott a „Járat kész” a futáré)
  autoFinishBox?: string | null; onAutoFinishHandled?: () => void
  // az utolsó boxnál a Box-lap gombja „Járat kész” volt: ezzel az idővel zárul a járat (a WhatsApp ott már megnyílt)
  autoDoneAt?: string | null
}) {
  const done = idx >= stops.length && stops.length > 0
  const cur = stops[idx]
  // A box adatlapja (fotó, „hol található” leírás, megjegyzés) a navigálás mellett egy koppintásra
  const [showBox, setShowBox] = useState(false)
  // „Kiindultam” után: teljes képernyős „Navigáció indítása” (a jelzés koppintása a WhatsAppot nyitotta —
  // a telefon egy koppintásból csak egy appot enged; visszaváltva ez az egy koppintás indítja a navigációt)
  const [navPrompt, setNavPrompt] = useState(() => navPromptPending())
  const closeNavPrompt = () => { clearNavPrompt(); setNavPrompt(false) }
  useEffect(() => {
    const h = () => setNavPrompt(navPromptPending())
    window.addEventListener(PROMPT_EVENT, h)
    return () => window.removeEventListener(PROMPT_EVENT, h)
  }, [])
  // Késés: ha a terv határideje (eddig kell végezni a boxban) lejárt, a leadáskor meg kell adni az okot
  const [late, setLate] = useState<number | null>(null)
  // Több ok is jelölhető egyszerre (+ szabad szöveg)
  const [reasons, setReasons] = useState<string[]>([])
  const [reasonText, setReasonText] = useState('')
  // Átvitel: az előző késő boxnál megadott okok (pl. „Kamion késett”) a következő késő boxoknál
  // előre be vannak jelölve, amíg a futár be nem hozza a késést (egy box időben → törlődik).
  // sessionStorage: újratöltés / oldalváltás után is megmarad a napon belül.
  // a naphoz kötve: a tegnapi késés-ok ne ragadjon rá a mai első késő boxra
  const carryKey = `late-carry:${workDayISO()}:${code}:${round}`
  const [carry, setCarry] = useState<string[]>(() => { try { return JSON.parse(sessionStorage.getItem(carryKey) ?? '[]') as string[] } catch { return [] } })
  const saveCarry = (list: string[]) => { setCarry(list); try { sessionStorage.setItem(carryKey, JSON.stringify(list)) } catch { /* nem kritikus */ } }
  useEffect(() => { setShowBox(false); setLate(null); setReasons([]); setReasonText('') }, [idx])
  // a terv idői (érkezés, határidő) csak arra a körre, amelyikre a betöltött terv szól — ott a késés okát kérjük
  const curEta = planTime(cur?.eta, round, plannedStart)
  const curDeadline = planTime(cur?.deadline, round, plannedStart)
  const lateNow = lateMinutes(curDeadline, 1)
  const isLast = idx === stops.length - 1
  // Automatikus navigáció: a „Kész, következő” a következő box GPS-koordinátájára nyitja és indítja a navigációt
  // (a Profilban kapcsolható). Az utolsó boxnál nincs — ott a „Járat kész” üzenete megy a csoportba.
  const nextNav = !isLast ? navTargetOf(stops[idx + 1]?.box) : null
  const afterFill: AfterFill | null = cur ? { boxId: cur.box_id, nav: nextNav, deadline: curDeadline, carryKey, routeCode: code, depot: { lat: depot.lat, lng: depot.lng, title: depot.name, address: depot.address } } : null
  // ha a „Járat kész” a Box-lapon már elment, a lezárásnál nem nyitjuk újra a WhatsAppot — csak rögzítünk
  const preDone = useRef<Date | null>(null)
  const routeDone = () => (isLast ? onRouteDone?.(preDone.current ?? undefined) : undefined)
  // fromTap: a futár koppintott (akkor nyitható a navigáció); a Box-lapról érkező automatikus lezárásnál
  // a Box-lap gombja már megnyitotta
  const finish = (fromTap = true) => {
    // a késést a koppintás pillanatában számoljuk (a kártya utolsó kirajzolása percekkel korábbi lehet)
    const lateNow = lateMinutes(curDeadline, 1)
    if (lateNow != null && lateNow > 0) {
      // Késés okát körönként egyszer kérdezzük: amíg a futár késésben van, az előzőleg megadott ok megy tovább
      if (carry.length) { if (fromTap) openNav(nextNav); go(idx + 1, { minutes: lateNow, reason: carry.join('; ') }, routeDone()); return }
      setLate(lateNow); setReasons(carry); return
    }
    // időben leadva: a késés behozva, az átvitt okok törlődnek
    if (carry.length) saveCarry([])
    if (fromTap) openNav(nextNav)
    go(idx + 1, undefined, routeDone())
  }
  const toggleReason = (r: string) => setReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))
  const reasonAll = [...reasons, ...(reasonText.trim() ? [reasonText.trim()] : [])].join('; ')
  const saveLate = () => {
    if (late == null || !reasonAll) return
    // a szabad szöveges ok is továbbmegy a kör következő késő boxaira
    saveCarry(reasonAll.split('; ').filter(Boolean))
    openNav(nextNav)
    go(idx + 1, { minutes: late, reason: reasonAll }, routeDone())
  }
  // A Box-lap „Kész, következő” gombja után: ugyanaz történik, mintha itt nyomta volna meg — egyszer
  const autoDone = useRef<string | null>(null)
  useEffect(() => {
    if (!autoFinishBox || !cur || cur.box_id !== autoFinishBox || locked || done || autoDone.current === autoFinishBox) return
    // az utolsó boxot csak akkor zárjuk magától, ha a Box-lap gombja „Járat kész” volt (különben a „Járat kész” a futáré)
    if (isLast && !autoDoneAt) return
    // a felcsatolás UTÁN indítjuk (nem az effektben közvetlenül): így a mentés állapota biztosan visszaér a kártyára
    const t = setTimeout(() => {
      if (autoDone.current === autoFinishBox) return
      autoDone.current = autoFinishBox
      if (isLast && autoDoneAt) preDone.current = new Date(autoDoneAt)
      finish(false)
      onAutoFinishHandled?.()
    }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFinishBox, cur?.box_id, locked, done, isLast, autoDoneAt])
  const curNav = navTargetOf(cur?.box)
  return (
          <div className="card stack" style={{ gap: 10, borderColor: 'var(--primary)' }}>
            {navPrompt && !locked && cur && curNav && (
              <NavPromptOverlay sub={`${idx + 1}. cím a ${stops.length}-ből`} title={`${cur.box.code ? `${cur.box.code} · ` : ''}${cur.box.name}`} address={cur.box.address} target={curNav} onClose={closeNavPrompt} />
            )}
            <div className="between">
              <div className="card-title" style={{ margin: 0 }}><Icon name="map" />{code} járat{round === 2 ? ' · 2. kör' : ''}</div>
              <span className="badge num">{plate}</span>
            </div>
            {stops.length === 0 ? (
              <div className="tiny muted">Ehhez a járathoz még nincs box — szólj a vezetőnek.</div>
            ) : done ? (
              <div className="stack" style={{ gap: 6 }}>
                <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--primary-ghost)', border: '1px solid var(--success)' }}>
                  <div style={{ fontWeight: 800, fontSize: 17 }}><Icon name="truck" /> Kész — irány a raktár!</div>
                  <div className="tiny muted">{hasNextRound
                    ? `Mind a ${stops.length} cím leadva. A raktárban: „Megérkeztem”, aztán „Elszámoltam” (ha most adod le a visszárut), majd „Kiindultam” a ${round + 1}. körre — ez a kör akkor összecsukódik.`
                    : `Mind a ${stops.length} cím leadva. A raktárban: „Elszámoltam” a visszáruk leadásakor, majd a Box-lap lezárása, végül „Autó lerakva”.`}</div>
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}><Icon name="warehouse" size={18} /> {depot.name}</div>
                  {depot.address && <div className="small muted">{depot.address}</div>}
                </div>
                <a className="btn" href={navUrl(navApp, depot.lat, depot.lng)} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => { if (launchNav(navApp, depot.lat, depot.lng)) e.preventDefault() }}>
                  <Icon name="navigation" />Navigálás a raktárba ({NAV_LABEL[navApp]})
                </a>
                <button type="button" className="btn ghost sm auto" disabled={busy || locked} onClick={() => go(stops.length - 1)}><Icon name="arrow-left" size={14} />Vissza az utolsóra</button>
              </div>
            ) : cur ? (
              <>
                <div className="between" style={{ alignItems: 'baseline' }}>
                  <span className="small muted">{idx + 1}. cím a {stops.length}-ből</span>
                  <span className="tiny muted">{stops.length - idx - 1} van hátra</span>
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}><span className="badge primary num" style={{ marginRight: 6, verticalAlign: 'middle' }}>{idx + 1}/{stops.length}</span>{cur.box.code ? `${cur.box.code} · ` : ''}{cur.box.name}</div>
                  <div className="small muted">{cur.box.address}</div>
                  {(curEta || curDeadline) && (
                    <div className="tiny" style={{ marginTop: 4, color: lateNow != null && lateNow > 0 ? 'var(--danger)' : 'var(--text-dim)' }}>
                      <Icon name="clock" size={12} />{curEta ? ` terv: érkezés ${curEta}` : ''}{curDeadline ? `${curEta ? ' ·' : ''} határidő ${curDeadline}` : ''}
                      {lateNow != null && lateNow > 0 ? <strong> · késésben {lateNow} perc</strong> : null}
                    </div>
                  )}
                  {/* A box leírása csak a „Box” gombra nyíló kártyán — a járat-kártya maradjon rövid */}
                  {cur.box.notes && <div className="small" style={{ marginTop: 6, padding: '6px 8px', borderRadius: 8, background: 'var(--warning-ghost, rgba(245,158,11,0.12))', color: 'var(--warning)', fontWeight: 600 }}><Icon name="key" size={14} />{cur.box.notes}</div>}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {cur.box.lat != null && cur.box.lng != null ? (
                    <a className="btn" style={{ flex: 2 }} href={navUrl(navApp, cur.box.lat, cur.box.lng)} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => { if (launchNav(navApp, cur.box.lat!, cur.box.lng!)) e.preventDefault() }}>
                      <Icon name="navigation" />Navigálás ({NAV_LABEL[navApp]})
                    </a>
                  ) : <div className="tiny muted" style={{ flex: 2 }}>Ehhez a boxhoz nincs koordináta a jegyzékben.</div>}
                  <button type="button" className={`btn ${showBox ? 'secondary' : 'ghost'}`} style={{ flex: 1 }} onClick={() => setShowBox((o) => !o)} aria-expanded={showBox}>
                    <Icon name="package" />Box
                  </button>
                </div>
                {showBox && <BoxCard box={cur.box} onClose={() => setShowBox(false)} hideNav />}
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn ghost sm" disabled={busy || locked || idx === 0} onClick={() => go(idx - 1)} style={{ flex: 1 }}><Icon name="arrow-left" size={14} />Előző</button>
                  {/* Egy fő gomb: amíg a box nincs kitöltve, a kitöltés; utána a „Kész, következő” */}
                  {onFillSheet && !sheetFilled
                    ? <button type="button" className="btn" disabled={locked} onClick={() => onFillSheet(afterFill)} style={{ flex: 2 }}><Icon name="clipboard" size={16} />Itt vagyok — Box-lap</button>
                    : <button type="button" className="btn" disabled={busy || locked || late != null} onClick={() => finish()} style={{ flex: 2 }}><Icon name={isLast ? 'flag' : 'check'} size={16} />{isLast ? 'Járat kész' : 'Kész, következő'}</button>}
                </div>
                {locked && <div className="tiny muted" style={{ textAlign: 'center' }}><Icon name="lock" size={12} /> A „Kiindultam” után indul a járat.</div>}
                {late == null && lateNow != null && lateNow > 0 && carry.length > 0 && !locked && (
                  <div className="tiny muted"><Icon name="clock" size={12} /> Késés oka: {carry.join('; ')} · <button type="button" className="link-btn inline tiny" onClick={() => { setLate(lateNow); setReasons(carry.filter((r) => LATE_REASONS.includes(r))); setReasonText(carry.filter((r) => !LATE_REASONS.includes(r)).join('; ')) }}>módosítás</button></div>
                )}
                {late != null && (
                  <div className="stack" style={{ gap: 6, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--danger)', background: 'var(--danger-ghost, rgba(239,68,68,0.08))' }}>
                    <div className="small" style={{ fontWeight: 800 }}><Icon name="clock" size={14} /> Késés {late} perc — a határidő {curDeadline} volt. Mi az oka? <span className="muted" style={{ fontWeight: 500 }}>(több is jelölhető)</span></div>
                    <div className="chips">
                      {LATE_REASONS.map((r) => (
                        <button key={r} type="button" className={`chip ${reasons.includes(r) ? 'active' : ''}`} aria-pressed={reasons.includes(r)} onClick={() => toggleReason(r)}>{r}</button>
                      ))}
                    </div>
                    {carry.length > 0 && reasons.some((r) => carry.includes(r)) && (
                      <div className="tiny muted"><Icon name="info" size={12} /> Az előző késő boxnál megadott ok előre bejelölve — amíg be nem hozod a késést, ez marad; módosíthatod.</div>
                    )}
                    <input className="input" value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="egyéb ok röviden (nem kötelező)…" />
                    <div className="row" style={{ gap: 6 }}>
                      <button type="button" className="btn ghost sm" style={{ flex: 1 }} onClick={() => { setLate(null); setReasons([]); setReasonText('') }}>Mégse</button>
                      <button type="button" className="btn sm" style={{ flex: 2 }} disabled={busy || !reasonAll} onClick={saveLate}><Icon name="send" size={14} />{isLast ? 'Mentés és járat kész' : 'Mentés és következő'}</button>
                    </div>
                    <div className="tiny muted">A vezetők értesítést kapnak a késésről és az okokról.</div>
                  </div>
                )}
                {onFillSheet && sheetFilled && <div className="tiny muted"><Icon name="check-circle" size={12} style={{ color: 'var(--success)' }} /> Box-lap kitöltve. <button type="button" className="link-btn inline tiny" onClick={() => onFillSheet(afterFill)}>Megnyitás</button></div>}
              </>
            ) : null}
            {stops.length > 0 && (
              <>
                <div className="between">
                  <span className="tiny muted">Navigáció: {NAV_LABEL[navApp]} · <Link to="/profil" style={{ color: 'inherit' }}>a Profilban módosítható</Link></span>
                  <button type="button" className="link-btn tiny" style={{ whiteSpace: 'nowrap' }} onClick={() => setOpenList((o) => !o)}>{openList ? 'lista elrejtése' : 'teljes lista'}</button>
                </div>
                {openList && (
                  <div className="stack" style={{ gap: 4 }}>
                    {stops.map((s, i) => (
                      <button key={s.id} type="button" className="row" disabled={busy || locked} onClick={() => go(i)}
                        style={{ gap: 6, alignItems: 'center', background: i === idx ? 'var(--primary-ghost)' : 'none', border: 'none', borderRadius: 6, padding: '4px 6px', color: 'inherit', textAlign: 'left', cursor: 'pointer', opacity: i < idx ? 0.6 : 1 }}>
                        <Icon name={i < idx ? 'check-circle' : i === idx ? 'navigation' : 'map-pin'} size={14} style={{ color: i < idx ? 'var(--success)' : i === idx ? 'var(--primary)' : 'var(--text-dim)' }} />
                        <span className="tiny" style={{ flex: 1, textDecoration: i < idx ? 'line-through' : 'none' }}>{i + 1}. {s.box.code ? `${s.box.code} · ` : ''}{s.box.name}</span>
                        {planTime(s.eta, round, plannedStart) && <span className="tiny muted num">{planTime(s.eta, round, plannedStart)}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
  )
}
