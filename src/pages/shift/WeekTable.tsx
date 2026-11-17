import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useMembers } from '../../hooks/useMembers'
import { useCars } from '../../hooks/useCars'
import { useCarCategories } from '../../hooks/useCarCategories'
import { useRoutes } from '../../hooks/useRoutes'
import PersonPicker from '../../components/PersonPicker'
import ConfirmButton from '../../components/ConfirmButton'
import CarTimeline, { type TimelineEntry } from '../../components/CarTimeline'
import { resolveNames } from '../../lib/names'
import { sendPush } from '../../lib/push'
import { todayISO, formatDate, memberLabel } from '../../lib/labels'
import { addDays, mondayOf, crewSizeFor, groupByCategory, DAY_NAMES_LONG, weekLabel } from '../../lib/calendar'
import Icon from '../../components/Icon'
import CrewDaysCard from '../../components/CrewDaysCard'
import { crewDayCounts } from '../../lib/crewDayCounts'
import type { Tables } from '../../lib/database.types'
import { errMsg } from '../../lib/errors'
import { nextShiftValues, isEmptyShift, type ShiftPeople } from '../../lib/shiftCell'
import { useRealtimeInvalidate } from '../../hooks/useRealtime'
import { navKey, navTarget, type NavDir } from '../../lib/weekNav'

type Car = Tables<'cars'>
type Shift = Tables<'shifts'>

// Azonos sormagasság a fix és a görgethető táblázatban: mezőnként 34 px + 12 px
// cella-padding; két körnél két blokk (+ a kör felirata) egymás alatt
const FIELD_H = 34
const BLOCK_PAD = 12
const ROUND_LABEL_H = 11
const HEAD_H = 36
type Field = 'driver_id' | 'loader_id' | 'trainee_id'
const FIELD_LABEL: Record<Field, string> = { driver_id: 'Sofőr', loader_id: 'Rakodó', trainee_id: 'Betanuló' }
const FIELD_PH: Record<Field, string> = { driver_id: '— sofőr —', loader_id: '— rakodó —', trainee_id: '— betanuló —' }

// ---- Heti táblázat-nézet: oszlopok = napok, sorok = autók (rendszám),
// cellákban sofőr/rakodó választó — a megszokott Google Sheets-es munkamenet mintájára ----
export default function WeekTable() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const today = todayISO()

  const [weekStart, setWeekStart] = useState(() => mondayOf(todayISO()))
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const { data: members } = useMembers()
  // MINDEN autó kell (az inaktivált autó heti beosztása különben eltűnne a
  // táblából, miközben a bérszámításban benne maradna) — az aktívak külön
  const { data: cars } = useCars()
  const activeCars = useMemo(() => (cars ?? []).filter((c) => c.active), [cars])
  const { data: categories } = useCarCategories()
  // Névvel ellátott körök (R, G, I…) — ha vannak, a cellában körönként választható
  const { data: routes } = useRoutes()
  const activeRoutes = useMemo(() => (routes ?? []).filter((r) => r.active), [routes])
  const routeCode = (id: string | null | undefined) => (routes ?? []).find((r) => r.id === id)?.code ?? null
  // Egy kört egy napon KÖRÖNKÉNT csak egy autó vihet: az adott körben más autónál
  // már beírt körök foglaltak (a másik körben szabadon választható)
  const takenRoutes = (date: string, round: number, exceptCarId: string): Map<string, string> => {
    const m = new Map<string, string>()
    for (const t of takenIndex.get(`${date}|${round}`) ?? []) if (t.carId !== exceptCarId) m.set(t.routeId, carOf(t.carId)?.plate ?? '?')
    return m
  }
  const [addedCars, setAddedCars] = useState<string[]>([])
  // a vezetők neve után ott a szerepük; azonos névnél a futár kerül előre (a begépelt név első találata ő legyen)
  const memberOptions = useMemo(() => (members ?? []).map((m) => ({ id: m.id, label: memberLabel(m) })).sort((a, b) => a.label.localeCompare(b.label, 'hu')), [members])
  const [error, setError] = useState<string | null>(null)
  const [busyCell, setBusyCell] = useState<string | null>(null)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)
  // Sor-menü (autó cseréje / kivétele a hétből)
  const [rowMenu, setRowMenu] = useState<{ carId: string; top: number; left: number } | null>(null)
  const [rowBusy, setRowBusy] = useState(false)

  // Más vezető / másik fül módosítása azonnal látsszon (LOG-07)
  useRealtimeInvalidate(currentWorkspaceId, ['shifts'], [['shift-week'], ['shift-cal']])
  const { data: serverShifts, dataUpdatedAt } = useQuery({
    queryKey: ['shift-week', currentWorkspaceId, weekStart],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('shifts').select('*')
        .eq('workspace_id', currentWorkspaceId!)
        .gte('work_date', weekStart).lte('work_date', addDays(weekStart, 6))
      if (error) throw error
      return (data ?? []) as Shift[]
    },
  })
  // A most beírt, még mentés alatt álló cellák: AZONNAL látszanak a táblában, a mentés a háttérben megy.
  // Kulcs: autó|nap|kör. A réteg a szerverről jött hétre kerül rá, így egy közbeeső újratöltés (másik cella mentése,
  // élő frissítés) sem tünteti el a már beírt nevet; a mentés UTÁNI első friss adat érkezésekor kerül le.
  const [overlay, setOverlay] = useState<Record<string, { shown: ShiftPeople; isBox: boolean; seq: number; doneAt?: number }>>({})
  const shifts = useMemo(() => {
    const keys = Object.keys(overlay)
    if (!serverShifts || keys.length === 0) return serverShifts
    const last = addDays(weekStart, 6)
    const out = [...serverShifts]
    for (const k of keys) {
      const [carId, date, r] = k.split('|')
      if (date < weekStart || date > last) continue
      const round = Number(r), p = overlay[k]
      const at = out.findIndex((x) => x.car_id === carId && x.work_date === date && (x.round ?? 1) === round)
      if (isEmptyShift(p.shown)) { if (at >= 0) out.splice(at, 1) }
      else if (at >= 0) out[at] = { ...out[at], ...p.shown }
      else out.push({ id: `tmp-${k}`, workspace_id: currentWorkspaceId, work_date: date, car_id: carId, round, ...p.shown, is_box: p.isBox } as Shift)
    }
    return out
  }, [serverShifts, overlay, weekStart, currentWorkspaceId])
  useEffect(() => {
    setOverlay((o) => {
      const drop = Object.keys(o).filter((k) => o[k].doneAt != null && dataUpdatedAt > o[k].doneAt!)
      if (drop.length === 0) return o
      const n = { ...o }
      for (const k of drop) delete n[k]
      return n
    })
  }, [dataUpdatedAt, overlay])
  // A hét beosztásában szereplő, de már nem választható emberek (letiltva / áthelyezve): a nevük látsszon a cellában,
  // ne üres helyként — a soruk attól még él (bér, export, heti értesítés)
  const memberIdSet = useMemo(() => new Set((members ?? []).map((m) => m.id)), [members])
  const goneIds = useMemo(() => {
    if (!members) return [] as string[]
    const ids = new Set<string>()
    for (const sh of shifts ?? []) for (const id of [sh.driver_id, sh.loader_id, sh.trainee_id]) if (id && !memberIdSet.has(id)) ids.add(id)
    return [...ids].sort()
  }, [members, memberIdSet, shifts])
  const { data: goneNames } = useQuery({
    queryKey: ['member-names', goneIds.join(',')],
    enabled: goneIds.length > 0,
    staleTime: 10 * 60_000,
    queryFn: () => resolveNames(goneIds),
  })

  // Napközbeni autócserék a héten: user+nap szerinti idővonalak, ahol volt váltás
  const { data: weekSwitches } = useQuery({
    queryKey: ['week-car-switches', currentWorkspaceId, weekStart],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data } = await supabase.from('check_ins')
        .select('user_id, work_date, checked_in_at, checked_out_at, switch_reason, car:cars!check_ins_car_id_fkey(plate)')
        .eq('workspace_id', currentWorkspaceId!)
        .gte('work_date', weekStart).lte('work_date', addDays(weekStart, 6))
        .order('checked_in_at')
      const rows = data ?? []
      // csoportosítás user+nap szerint; csak ahol tényleg volt autócsere
      const groups = new Map<string, { userId: string; date: string; entries: TimelineEntry[] }>()
      for (const r of rows) {
        const key = `${r.user_id}|${r.work_date}`
        const g = groups.get(key) ?? { userId: r.user_id, date: r.work_date, entries: [] }
        g.entries.push({
          plate: (r.car as unknown as { plate: string } | null)?.plate ?? '?',
          from: r.checked_in_at,
          to: r.checked_out_at,
          reason: r.switch_reason,
        })
        groups.set(key, g)
      }
      const withSwitch = [...groups.values()].filter((g) => g.entries.length > 1 || g.entries.some((e) => e.reason))
      const names = await resolveNames(withSwitch.map((g) => g.userId))
      return withSwitch
        .map((g) => ({ ...g, name: names[g.userId] ?? 'Munkatárs' }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'hu'))
    },
  })

  // Gyorsítás: a foglalt járatok nap + kör szerint előre csoportosítva (cellánként csak az adott nap néhány sora)
  const takenIndex = useMemo(() => {
    const m = new Map<string, { routeId: string; carId: string }[]>()
    for (const s of shifts ?? []) {
      if (!s.route_id) continue
      const k = `${s.work_date}|${s.round ?? 1}`
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push({ routeId: s.route_id, carId: s.car_id })
    }
    return m
  }, [shifts])
  // Gyorsítás: beosztás autó + nap + kör szerint indexelve (a tábla minden cellája többször is lekérdezi)
  const shiftIndex = useMemo(() => {
    const m = new Map<string, NonNullable<typeof shifts>[number]>()
    // az ELSŐ találat számít, ahogy eddig a keresésnél is
    for (const s of shifts ?? []) { const k = `${s.car_id}|${s.work_date}|${s.round ?? 1}`; if (!m.has(k)) m.set(k, s) }
    return m
  }, [shifts])
  const shiftAt = (carId: string, date: string, round = 1) => shiftIndex.get(`${carId}|${date}|${round}`)

  // Sor-módok: 2. kör (szezon) és betanuló mező — kézzel bekapcsolva, vagy ha a
  // héten már van ilyen adat az autónál, automatikusan
  const [roundCars, setRoundCars] = useState<string[]>([])
  const [traineeCars, setTraineeCars] = useState<string[]>([])
  // LOG-27: a meglévő 2. körös sorok akkor is látszanak, ha az autó már nem Box-kategóriás
  const hasRound2 = (carId: string) => ((isBox(carId) || isMixed(carId)) && roundCars.includes(carId)) || (shifts ?? []).some((s) => s.car_id === carId && s.round === 2)
  const hasTrainee = (carId: string) => traineeCars.includes(carId) || (shifts ?? []).some((s) => s.car_id === carId && !!s.trainee_id)
  const round2Count = (carId: string) => (shifts ?? []).filter((s) => s.car_id === carId && s.round === 2).length
  const traineeCount = (carId: string) => (shifts ?? []).filter((s) => s.car_id === carId && !!s.trainee_id).length

  // Sorok: amelyik autónak van beosztása a héten + a kézzel hozzáadottak
  // Kategória szerint csoportosítva (kategória nélküliek a végén), azon belül rendszám szerint
  const rowCars = useMemo(() => {
    const ids = new Set<string>(addedCars)
    for (const s of shifts ?? []) ids.add(s.car_id)
    const order = new Map((categories ?? []).map((c, i) => [c.id, i]))
    const rank = (c: Car) => (c.category_id && order.has(c.category_id) ? order.get(c.category_id)! : 9999)
    return (cars ?? [])
      .filter((c) => ids.has(c.id))
      .sort((a, b) => rank(a) - rank(b) || a.plate.localeCompare(b.plate))
  }, [shifts, addedCars, cars, categories])
  const rowCarIds = useMemo(() => rowCars.map((c) => c.id), [rowCars])
  // Archivált autó: a régi beosztásai látszanak, de új beosztás nem adható rá
  const carById = useMemo(() => new Map((cars ?? []).map((c) => [c.id, c])), [cars])
  const categoryById = useMemo(() => new Map((categories ?? []).map((k) => [k.id, k])), [categories])
  const isArchived = (carId: string) => carById.get(carId)?.active === false
  const categoryName = (id: string | null) => (categories ?? []).find((c) => c.id === id)?.name ?? null
  const crewOf = (carId: string) => crewSizeFor(cars, categories, carId)
  // Körök (1./2. kör, kör-nevek) csak a Box-kategóriás (AlzaBox-töltő) autóknál vannak — XL-nél nincs
  const isBox = (carId: string) => {
    const catId = carById.get(carId)?.category_id
    return !!(catId ? categoryById.get(catId) : undefined)?.box_sheet
  }
  // Vegyes autó: nincs kategóriája, mert hol Boxban, hol XL-ben dolgozik — a nap módját (Box / XL) a vezető
  // naponként adja meg, és a beosztás sorára mentjük (shifts.is_box). Box napon van járat és 2. kör, XL napon páros.
  const isMixed = (carId: string) => { const c = carById.get(carId); return !!c && !(c.category_id && categoryById.has(c.category_id)) }
  // Amíg a napra nincs beosztás (nincs sor, amire a mód menthető), a választás itt él
  const [pendingBox, setPendingBox] = useState<string[]>([])
  const dayIsBox = (carId: string, date: string): boolean => {
    if (!isMixed(carId)) return isBox(carId)
    const r1 = shiftAt(carId, date, 1), r2 = shiftAt(carId, date, 2)
    if (r1 || r2) return !!(r1?.is_box || r2?.is_box)
    return pendingBox.includes(`${carId}|${date}`)
  }
  // Az adott napon látszó körök: vegyes autónál a 2. kör csak Box napon (vagy ha már van benne adat)
  const roundsOn = (carId: string, date: string): number[] =>
    hasRound2(carId) && (!isMixed(carId) || dayIsBox(carId, date) || !!shiftAt(carId, date, 2)) ? [1, 2] : [1]
  // A cella mezői: sofőr, (rakodó — 2 fős kategória vagy ha be van töltve),
  // (betanuló — ha a sor betanuló-módban van vagy be van töltve)
  const fieldsOf = (carId: string, s?: Shift, date?: string): Field[] => {
    const f: Field[] = ['driver_id']
    const crew = isMixed(carId) && date ? (dayIsBox(carId, date) ? 1 : 2) : crewOf(carId)
    if (crew === 2 || s?.loader_id) f.push('loader_id')
    if (hasTrainee(carId) || s?.trainee_id) f.push('trainee_id')
    return f
  }
  // A sor magassága a hét legmagasabb cellájához igazodik (a két tábla
  // sormagassága különben szétcsúszna)
  const rowH = (carId: string) => {
    const rounds = hasRound2(carId) ? 2 : 1
    const maxFields = Math.max(...days.map((d) => Math.max(...[1, 2].map((r) => fieldsOf(carId, shiftAt(carId, d, r), d).length))))
    const header = rounds > 1 || isMixed(carId) || (isBox(carId) && activeRoutes.length > 0) ? ROUND_LABEL_H + 10 : 0
    return rounds * (maxFields * FIELD_H + BLOCK_PAD + header) + (rounds - 1) * 6
  }
  // Hány egymást követő sor tartozik ugyanabba a kategóriába (rowSpan-hoz)
  const groupSpan = (idx: number) => {
    const cat = rowCars[idx].category_id ?? ''
    let n = 1
    while (idx + n < rowCars.length && (rowCars[idx + n].category_id ?? '') === cat) n++
    return n
  }
  const isGroupStart = (idx: number) => idx === 0 || (rowCars[idx - 1].category_id ?? '') !== (rowCars[idx].category_id ?? '')

  // Fejenkénti napszám ezen a héten (összes, Box, XL, betanuló) — a havi nézettel közös számítás
  const weekCounts = useMemo(() => {
    const isBoxCar = new Map((cars ?? []).map((c) => [c.id, !!c.category?.box_sheet]))
    return crewDayCounts(shifts ?? [], members ?? [], (id) => !!isBoxCar.get(id))
  }, [shifts, members, cars])

  // Ütközés: ugyanaz az ember aznap több AUTÓRA beosztva (ugyanannak az autónak
  // a két köre nem ütközés — szezonban egy ember mehet mindkettőt)
  const dupSet = useMemo(() => {
    const carsOf = new Map<string, Set<string>>()
    for (const s of shifts ?? []) for (const uid of [s.driver_id, s.loader_id, s.trainee_id]) {
      if (!uid) continue
      const k = `${s.work_date}|${uid}`
      if (!carsOf.has(k)) carsOf.set(k, new Set())
      carsOf.get(k)!.add(s.car_id)
    }
    return new Set([...carsOf.entries()].filter(([, cs]) => cs.size > 1).map(([k]) => k))
  }, [shifts])

  // Egy cella mentése a szerverre. A módosítás alapja a SZERVER aktuális sora, nem a cache (LOG-07) — így két vezető /
  // két fül nem írja felül egymás beírását (korábban mind a négy mező a régi cache-ből ment vissza).
  async function saveCell(carId: string, date: string, round: number, field: Field | 'route_id', value: string, extra: Partial<Pick<Shift, 'driver_id' | 'loader_id' | 'trainee_id'>> | undefined, mixedBox: boolean | undefined, ws: string, uid: string) {
    const { data: cur, error: curErr } = await supabase.from('shifts').select('id, driver_id, loader_id, trainee_id, route_id')
      .eq('car_id', carId).eq('work_date', date).eq('round', round).maybeSingle()
    if (curErr) throw curErr
    const next = nextShiftValues(cur, field, value, extra)
    // LOG-28: járat személy nélkül nem menthető — ne tűnjön el csendben
    if (field === 'route_id' && value && isEmptyShift(next)) throw new Error('Előbb válassz sofőrt vagy rakodót, utána a járatot.')
    if (isEmptyShift(next)) {
      // Minden mező üres → a napi (köri) beosztás törlődik
      if (cur) {
        const { error } = await supabase.from('shifts').delete().eq('id', cur.id)
        if (error) throw error
      }
    } else if (cur) {
      const { error } = await supabase.from('shifts').update(next).eq('id', cur.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('shifts').upsert({
        workspace_id: ws, work_date: date, car_id: carId, round,
        ...next, created_by: uid,
        // vegyes autó: a nap módja a sorra kerül (kategóriás autónál a szerver állítja be)
        ...(mixedBox != null ? { is_box: mixedBox } : {}),
      }, { onConflict: 'car_id,work_date,round' })
      if (error) throw error
    }
  }

  // A beírt név AZONNAL megjelenik a táblában (lásd az `overlay` réteget), a mentés a háttérben megy — korábban a szerver
  // olvasása, írása és a hét újratöltése mind a név megjelenése ELŐTT futott le, lassú neten másodpercekig üres maradt a mező.
  // Egy cella mentései sorban futnak (nem előzik meg egymást); hibánál a réteg lekerül, és a valódi állapot látszik.
  const saveQueue = useRef(new Map<string, Promise<void>>())
  const editSeq = useRef(0)
  function setCell(carId: string, date: string, round: number, field: Field | 'route_id', value: string, extra?: Partial<Pick<Shift, 'driver_id' | 'loader_id' | 'trainee_id'>>): Promise<void> {
    if (!currentWorkspaceId || !profile) return Promise.resolve()
    const ws = currentWorkspaceId, uid = profile.id
    setError(null)
    const shown = nextShiftValues(shiftAt(carId, date, round) ?? null, field, value, extra)
    if (field === 'route_id' && value && isEmptyShift(shown)) { setError('Előbb válassz sofőrt vagy rakodót, utána a járatot.'); return Promise.resolve() }
    const mixedBox = isMixed(carId) ? round === 2 || dayIsBox(carId, date) : undefined
    const slot = `${carId}|${date}|${round}`
    const seq = ++editSeq.current
    setOverlay((o) => ({ ...o, [slot]: { shown, isBox: mixedBox ?? isBox(carId), seq } }))
    const key = `${carId}|${date}`
    const run: Promise<void> = (saveQueue.current.get(key) ?? Promise.resolve())
      .then(() => saveCell(carId, date, round, field, value, extra, mixedBox, ws, uid))
      .then(() => true, (e) => {
        const msg = errMsg(e, 'Mentési hiba')
        setError(/ROUTE_TAKEN/.test(msg) ? msg.replace(/^.*ROUTE_TAKEN:\s*/, 'Nem menthető: ') : msg)
        return false
      })
      .then(async (ok) => {
        // ha közben újabb beírás jött ugyanerre a mezőre, az ő rétege marad (az ő mentése zárja le)
        setOverlay((o) => {
          if (o[slot]?.seq !== seq) return o
          if (ok) return { ...o, [slot]: { ...o[slot], doneAt: Date.now() } }
          const n = { ...o }; delete n[slot]; return n
        })
        if (saveQueue.current.get(key) === run) saveQueue.current.delete(key)
        await qc.invalidateQueries({ queryKey: ['shift-week'] })
        await qc.invalidateQueries({ queryKey: ['shift-cal'] })
      })
    saveQueue.current.set(key, run)
    return run
  }

  // Vegyes autó: a nap átállítása Box ↔ XL. Ha a napra már van beosztás, a sor(ok)ra mentjük;
  // XL-re váltáskor a járat lekerül, a 2. kört előbb ki kell üríteni.
  async function setDayMode(carId: string, date: string, box: boolean) {
    if (!currentWorkspaceId) return
    setError(null)
    const key = `${carId}|${date}`
    setBusyCell(key)
    try {
      const { data: rows, error: rErr } = await supabase.from('shifts').select('id, round').eq('car_id', carId).eq('work_date', date)
      if (rErr) throw rErr
      if (!box && (rows ?? []).some((r) => r.round === 2)) { setError('Előbb ürítsd ki a 2. kör mezőit ezen a napon, utána állíthatod XL-re.'); return }
      if ((rows ?? []).length > 0) {
        const { error } = await supabase.from('shifts').update(box ? { is_box: true } : { is_box: false, route_id: null })
          .in('id', (rows ?? []).map((r) => r.id))
        if (error) throw error
      }
      setPendingBox((p) => (box ? [...p.filter((x) => x !== key), key] : p.filter((x) => x !== key)))
      await qc.invalidateQueries({ queryKey: ['shift-week'] })
      await qc.invalidateQueries({ queryKey: ['shift-cal'] })
    } catch (e) {
      setError(errMsg(e, 'Mentési hiba'))
    } finally {
      setBusyCell(null)
    }
  }

  async function copyPrevWeek() {
    if (!currentWorkspaceId || !profile) return
    setCopyMsg(null); setError(null)
    const prevStart = addDays(weekStart, -7)
    const { data: prev, error: pErr } = await supabase.from('shifts').select('*')
      .eq('workspace_id', currentWorkspaceId).gte('work_date', prevStart).lt('work_date', weekStart)
    if (pErr) { setError(pErr.message); return }
    if ((prev ?? []).length === 0) { setCopyMsg('Az előző héten nincs beosztás.'); return }
    const rows = prev!.map((s) => ({
      workspace_id: currentWorkspaceId, work_date: addDays(s.work_date, 7), car_id: s.car_id, round: s.round ?? 1,
      driver_id: s.driver_id, loader_id: s.loader_id, trainee_id: s.trainee_id, route_id: s.route_id, created_by: profile.id,
      is_box: s.is_box, // vegyes autónál a nap módja is átjön (kategóriás autónál a szerver úgyis a kategóriából állítja)
    }))
    const { error } = await supabase.from('shifts').upsert(rows, { onConflict: 'car_id,work_date,round' })
    // LOG-29: a trigger üzenete (ROUTE_TAKEN) itt is olvashatóan
    if (error) { const m = errMsg(error, 'Mentési hiba'); setError(/ROUTE_TAKEN/.test(m) ? m.replace(/^.*ROUTE_TAKEN:\s*/, 'Nem másolható: ') : m); return }
    setCopyMsg(`${rows.length} beosztás átmásolva az előző hétről (a héten már meglévő többi sor megmaradt).`)
    await qc.invalidateQueries({ queryKey: ['shift-week'] })
    await qc.invalidateQueries({ queryKey: ['shift-cal'] })
  }

  const carOf = (id: string) => carById.get(id)

  // Billentyűs lépkedés a névmezők között, mint egy táblázatkezelőben: Tab = következő nap, Shift+Tab = előző nap,
  // Enter = az alatta lévő név. (A névmezők mentés közben sem zárolnak, így a fókusz nem vész el.)
  const navInputs = () => [...(scrollRef.current?.querySelectorAll<HTMLInputElement>('input[data-wk]') ?? [])]
  function handleNav(key: string, dir: NavDir): boolean {
    const inputs = navInputs()
    const slots = inputs.filter((i) => !i.disabled || i.dataset.wk === key).map((i) => {
      const [car, day, round, field] = (i.dataset.wk ?? '').split('|')
      return { key: i.dataset.wk ?? '', car, day: Number(day), round: Number(round), field }
    })
    const target = navTarget(slots, key, dir, days.length)
    const el = target ? inputs.find((i) => i.dataset.wk === target) : null
    if (!el) return false
    el.focus()
    return true
  }

  // Ragadó nap-fejléc: lefelé görgetve a napok sávja a fejléc alatt marad.
  // (A vízszintesen görgethető táblázatban a sticky thead nem működik, ezért
  // egy fix sávot rajzolunk, és a görgetéssel együtt toljuk.)
  const wrapRef = useRef<HTMLDivElement>(null)
  const leftTableRef = useRef<HTMLTableElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const daysHeadRef = useRef<HTMLTableSectionElement>(null)
  const [strip, setStrip] = useState<{ top: number; left: number; width: number; leftW: number; tableW: number; scrollLeft: number; cols: { left: number; width: number }[] } | null>(null)
  useEffect(() => {
    let raf = 0
    const measure = () => {
      raf = 0
      const head = daysHeadRef.current, wrap = wrapRef.current, leftT = leftTableRef.current, sc = scrollRef.current
      if (!head || !wrap || !leftT || !sc) { setStrip(null); return }
      const topbar = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0
      const headRect = head.getBoundingClientRect()
      const wrapRect = wrap.getBoundingClientRect()
      // csak amíg a táblázat a képernyőn van, és az eredeti fejléc már kigörgött
      if (headRect.bottom >= topbar || wrapRect.bottom < topbar + 60) { setStrip(null); return }
      const ths = [...head.querySelectorAll('th')] as HTMLElement[]
      setStrip({
        top: topbar, left: wrapRect.left, width: wrapRect.width, leftW: leftT.getBoundingClientRect().width,
        tableW: sc.scrollWidth, scrollLeft: sc.scrollLeft,
        cols: ths.map((th) => ({ left: th.offsetLeft, width: th.offsetWidth })),
      })
    }
    const onChange = () => { if (!raf) raf = requestAnimationFrame(measure) }
    window.addEventListener('scroll', onChange, { passive: true })
    window.addEventListener('resize', onChange)
    const sc = scrollRef.current
    sc?.addEventListener('scroll', onChange, { passive: true })
    onChange()
    return () => {
      window.removeEventListener('scroll', onChange); window.removeEventListener('resize', onChange)
      sc?.removeEventListener('scroll', onChange)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [rowCarIds.length, days])
  const selStyle = { minHeight: 32, padding: '4px 6px', fontSize: 12, borderRadius: 8 } as const

  const weekShiftsOf = (carId: string) => (shifts ?? []).filter((x) => x.car_id === carId)

  // Autó cseréje: a heti beosztások átkerülnek a másik autóra (csak olyanra, amelynek nincs beosztása a héten)
  async function swapCar(fromId: string, toId: string) {
    if (!currentWorkspaceId) return
    setError(null); setRowBusy(true)
    try {
      const { error } = await supabase.from('shifts').update({ car_id: toId })
        .eq('workspace_id', currentWorkspaceId).eq('car_id', fromId)
        .gte('work_date', weekStart).lte('work_date', addDays(weekStart, 6))
      if (error) throw error
      setAddedCars((p) => [...p.filter((id) => id !== fromId), toId])
      setRowMenu(null)
      await qc.invalidateQueries({ queryKey: ['shift-week'] })
      await qc.invalidateQueries({ queryKey: ['shift-cal'] })
    } catch (e) {
      setError(errMsg(e, 'Az autó cseréje nem sikerült'))
    } finally { setRowBusy(false) }
  }

  // Autó kivétele a hétből: a heti beosztásai törlődnek, a sor eltűnik
  async function removeCarFromWeek(carId: string) {
    if (!currentWorkspaceId) return
    setError(null); setRowBusy(true)
    try {
      const { error } = await supabase.from('shifts').delete()
        .eq('workspace_id', currentWorkspaceId).eq('car_id', carId)
        .gte('work_date', weekStart).lte('work_date', addDays(weekStart, 6))
      if (error) throw error
      setAddedCars((p) => p.filter((id) => id !== carId))
      setRowMenu(null)
      await qc.invalidateQueries({ queryKey: ['shift-week'] })
      await qc.invalidateQueries({ queryKey: ['shift-cal'] })
    } catch (e) {
      setError(errMsg(e, 'Az autó kivétele nem sikerült'))
    } finally { setRowBusy(false) }
  }

  // 📣 Heti beosztás kiküldése: minden beosztott munkatárs SZEMÉLYRE SZABOTT
  // pusht kap a saját napjaival (nap, autó, szerep). A vezető dönt, mikor
  // "közzétehető" a hét — ezért gombra megy, nem minden mentésnél.
  const [publishMsg, setPublishMsg] = useState<string | null>(null)
  const [publishBusy, setPublishBusy] = useState(false)
  const weekPeople = useMemo(() => {
    const ids = new Set<string>()
    for (const sh of shifts ?? []) {
      if (sh.driver_id) ids.add(sh.driver_id)
      if (sh.loader_id) ids.add(sh.loader_id)
      if (sh.trainee_id) ids.add(sh.trainee_id)
    }
    return ids
  }, [shifts])

  async function publishWeek() {
    const list = shifts ?? []
    if (weekPeople.size === 0) { setPublishMsg('Ezen a héten még nincs beosztás — nincs kinek küldeni.'); return }
    setPublishBusy(true)
    setPublishMsg(null)
    try {
      const DAY_ABBR = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V']
      const dayIdx = (iso: string) => (new Date(`${iso}T12:00:00`).getDay() + 6) % 7
      const byUser = new Map<string, { date: string; text: string }[]>()
      const add = (uid: string | null, date: string, carId: string, role: string, round: number, route: string | null) => {
        if (!uid) return
        const plate = carOf(carId)?.plate ?? '?'
        const single = crewOf(carId) === 1 && role !== 'betanuló'
        const entry = { date, text: `${DAY_ABBR[dayIdx(date)]}: ${plate}${route ? ` ${route} járat` : ''}${round === 2 ? ' (2. kör)' : ''}${single ? '' : ` (${role})`}` }
        byUser.set(uid, [...(byUser.get(uid) ?? []), entry])
      }
      for (const sh of list) {
        const rc = routeCode(sh.route_id)
        add(sh.driver_id, sh.work_date, sh.car_id, 'sofőr', sh.round ?? 1, rc)
        add(sh.loader_id, sh.work_date, sh.car_id, 'rakodó', sh.round ?? 1, rc)
        add(sh.trainee_id, sh.work_date, sh.car_id, 'betanuló', sh.round ?? 1, rc)
      }
      // Párhuzamosan megy minden címzettnek; a szerver megmondja, hány ESZKÖZRE
      // sikerült ténylegesen kézbesíteni — ezt írjuk ki, nem vak "kiküldve"-t.
      // allSettled: egyetlen hálózati hiba ne buktassa a többiek már kiment
      // értesítését (különben újraküldésnél duplán kapnák meg)
      const results = await Promise.allSettled(
        [...byUser.entries()].map(async ([uid, entries]) => {
          entries.sort((a, b) => a.date.localeCompare(b.date))
          const dayCount = new Set(entries.map((e) => e.date)).size
          const body = `${formatDate(weekStart)} – ${formatDate(days[6])}: ${dayCount} nap — ${entries.map((e) => e.text).join(', ')}`
          return await sendPush([uid], '📅 Megjött a heti beosztásod', body, '/beosztas')
        }),
      )
      const reached = results.filter((r) => r.status === 'fulfilled' && r.value > 0).length
      const failed = results.filter((r) => r.status === 'rejected').length
      setPublishMsg(
        reached === 0
          ? `Senkit sem ért el: ${byUser.size} munkatársból egyiküknél sincs bekapcsolva az értesítés (Profil → Értesítések bekapcsolása, iPhone-on kezdőképernyőre telepítve).${failed ? ` (${failed} küldés hibára futott.)` : ''}`
          : `Beosztás kiküldve: ${byUser.size} munkatársból ${reached} főt ért el az értesítés. A többieknél nincs bekapcsolva az értesítés.${failed ? ` ${failed} küldés hibára futott — próbáld újra.` : ''}`,
      )
    } catch (e) {
      setPublishMsg('Hiba a kiküldésnél: ' + (errMsg(e, 'ismeretlen')))
    } finally {
      setPublishBusy(false)
    }
  }

  return (
    <>
      <div className="card stack">
        <div className="between">
          <button className="icon-btn" aria-label="Előző hét" onClick={() => setWeekStart(addDays(weekStart, -7))}><Icon name="chevron-left" /></button>
          <div className="card-title" style={{ margin: 0, textAlign: 'center' }}>{weekLabel(weekStart, days[6])}</div>
          <button className="icon-btn" aria-label="Következő hét" onClick={() => setWeekStart(addDays(weekStart, 7))}><Icon name="chevron-right" /></button>
        </div>
        <div className="btn-grid">
          <button className="btn secondary sm" onClick={() => setWeekStart(mondayOf(todayISO()))}><Icon name="calendar" />Ez a hét</button>
          <ConfirmButton className="btn secondary sm" confirmLabel="Másolás (az azonos cellákat felülírja)" onConfirm={() => void copyPrevWeek()}><Icon name="clipboard" />Előző hét másolása</ConfirmButton>
        </div>
        <ConfirmButton
          className="btn sm"
          confirmLabel={`Küldés ${weekPeople.size} munkatársnak`}
          disabled={publishBusy || weekPeople.size === 0}
          onConfirm={() => void publishWeek()}
        >
          <Icon name="send" />{publishBusy ? 'Küldés…' : 'Beosztás kiküldése értesítésben'}
        </ConfirmButton>
        {error && <div className="alert error">{error}</div>}
        {copyMsg && <div className="alert info">{copyMsg}</div>}
        {publishMsg && (
          <div className={`alert ${publishMsg.startsWith('Hiba') || publishMsg.startsWith('Senkit') ? 'error' : publishMsg.startsWith('Beosztás kiküldve') ? 'success' : 'info'}`}>
            <Icon name={publishMsg.startsWith('Beosztás kiküldve') ? 'check-circle' : 'alert-triangle'} size={16} style={{ verticalAlign: -3 }} /> {publishMsg}
          </div>
        )}

        {/* Bal blokk (kategória + rendszám) FIXEN áll, csak a nap-oszlopok görgethetők.
            A két táblázat sorai azonos, rögzített magasságúak → mindig egy vonalban maradnak. */}
        {strip && (
          <div style={{ position: 'fixed', top: strip.top, left: strip.left, width: strip.width, zIndex: 15, display: 'flex', gap: 8, background: 'var(--bg)', borderBottom: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: '4px 0' }} aria-hidden="true">
            <div className="wk-head" style={{ width: strip.leftW, flexShrink: 0, textAlign: 'right', paddingRight: 10, alignSelf: 'center' }}>Autó</div>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{ position: 'relative', width: strip.tableW, height: HEAD_H, transform: `translateX(${-strip.scrollLeft}px)` }}>
                {days.map((d, i) => strip.cols[i] && (
                  <div key={d} className="wk-day" style={{ position: 'absolute', left: strip.cols[i].left, width: strip.cols[i].width, top: 0, fontSize: 11, padding: '3px 4px', borderRadius: 6, textAlign: 'center', background: d === today ? 'rgba(20,184,166,.14)' : undefined, fontWeight: 600, color: 'var(--text-dim)', minWidth: 0 }}>
                    <div>{DAY_NAMES_LONG[i]}</div>
                    <div className="muted">{d.slice(5).replace('-', '.')}.</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={wrapRef} className="wk-wrap" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <table ref={leftTableRef} style={{ borderCollapse: 'separate', borderSpacing: '3px 10px', flexShrink: 0 }}>
            <thead>
              <tr style={{ height: HEAD_H }}>
                <th className="wk-head wk-catcol"><span className="wk-cat-label">Kategória</span></th>
                <th className="wk-head wk-autocol" style={{ textAlign: 'left', minWidth: 84, paddingLeft: 10 }}>Autó</th>
              </tr>
            </thead>
            <tbody>
              {rowCarIds.map((carId, rowIdx) => (
                <Fragment key={carId}>
                  {rowIdx > 0 && isGroupStart(rowIdx) && (
                    <tr style={{ height: 8 }}>
                      <td colSpan={2} style={{ padding: 0 }}><div style={{ height: 2, background: 'var(--border)', borderRadius: 1 }} /></td>
                    </tr>
                  )}
                <tr style={{ height: rowH(carId) }}>
                  {isGroupStart(rowIdx) && (
                    <td className="wk-catcol" rowSpan={groupSpan(rowIdx)} title={categoryName(rowCars[rowIdx].category_id) ?? 'Vegyes autó (nincs kategóriája): naponként állítható Box vagy XL'}>
                      {categoryName(rowCars[rowIdx].category_id) ?? 'Vegyes'}
                    </td>
                  )}
                  <td className="wk-plate" style={{ background: rowIdx % 2 ? 'var(--bg-elev-2)' : 'var(--bg)', padding: 0 }}>
                    <button
                      type="button"
                      title="Autó cseréje / kivétele a hétből"
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setRowMenu(rowMenu?.carId === carId ? null : { carId, top: r.bottom + 4, left: r.left })
                      }}
                      className="wk-plate-btn"
                      style={{
                        width: '100%', height: '100%', minHeight: 40, border: 'none', background: 'transparent', color: 'inherit',
                        font: 'inherit', fontWeight: 800, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
                      }}
                    >
                      <span>{carOf(carId)?.plate ?? '?'}{isArchived(carId) && <span className="tiny" style={{ fontWeight: 600, marginLeft: 4, color: 'var(--warning)' }}>archivált · csere →</span>}</span>
                      <span className="muted" style={{ fontSize: 14, lineHeight: 1 }}>⋯</span>
                    </button>
                  </td>
                </tr>
                </Fragment>
              ))}
            </tbody>
          </table>

          <div ref={scrollRef} style={{ overflowX: 'auto', flex: 1, minWidth: 0 }}>
            <table className="wk-days-table" style={{ borderCollapse: 'separate', borderSpacing: '3px 10px', width: '100%' }}>
              <thead ref={daysHeadRef}>
                <tr style={{ height: HEAD_H }}>
                  {days.map((d, i) => (
                    <th key={d} className="wk-day" style={{ fontSize: 11, padding: '3px 4px', borderRadius: 6, background: d === today ? 'rgba(20,184,166,.14)' : undefined }}>
                      <div>{DAY_NAMES_LONG[i]}</div>
                      <div className="muted">{d.slice(5).replace('-', '.')}.</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowCarIds.map((carId, rowIdx) => (
                  <Fragment key={carId}>
                    {rowIdx > 0 && isGroupStart(rowIdx) && (
                      <tr style={{ height: 8 }}>
                        <td colSpan={7} style={{ padding: 0 }}><div style={{ height: 2, background: 'var(--border)', borderRadius: 1 }} /></td>
                      </tr>
                    )}
                  <tr style={{ height: rowH(carId) }}>
                    {days.map((d, di) => {
                      const busy = busyCell === `${carId}|${d}`
                      const rowBg = rowIdx % 2 ? 'var(--bg-elev-2)' : 'var(--bg)'
                      const rounds = roundsOn(carId, d)
                      const mixed = isMixed(carId)
                      const boxDay = dayIsBox(carId, d)
                      return (
                        <td key={d} style={{ verticalAlign: 'top', background: d === today ? 'rgba(20,184,166,.10)' : rowBg, borderRadius: 8, padding: 4, opacity: busy ? 0.55 : 1 }}>
                          {rounds.map((round) => {
                            const s = shiftAt(carId, d, round)
                            // 1 fős kategória: csak sofőr-mező (a rakodó/betanuló akkor is látszik, ha be van töltve, hogy törölhető legyen)
                            const fields = fieldsOf(carId, s, d)
                            return (
                              <div key={round} style={{ marginBottom: round < rounds.length ? 6 : 0 }}>
                                {(rounds.length > 1 || mixed || (boxDay && activeRoutes.length > 0)) && (
                                  <div className="between" style={{ gap: 4, minHeight: ROUND_LABEL_H + 10, marginBottom: 2 }}>
                                    {mixed && round === 1 ? (
                                      // Vegyes autó: a nap módja egy koppintással vált (Box: járat + 2. kör, XL: páros)
                                      <button type="button" disabled={busy || isArchived(carId)} aria-pressed={boxDay}
                                        title={boxDay ? 'Box nap — koppints, ha ezen a napon XL-ben megy' : 'XL nap — koppints, ha ezen a napon Boxban megy'}
                                        style={{ border: '1px solid var(--border)', background: boxDay ? 'var(--primary-ghost)' : 'transparent', color: boxDay ? 'var(--primary)' : 'var(--text-dim)', borderRadius: 6, height: 20, padding: '0 6px', fontSize: 9, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                                        onClick={() => void setDayMode(carId, d, !boxDay)}>
                                        {boxDay ? (rounds.length > 1 ? 'Box · 1. kör' : 'Box') : 'XL'}
                                      </button>
                                    ) : (
                                      <span className="tiny muted" style={{ fontSize: 9, fontWeight: 700, paddingLeft: 2, whiteSpace: 'nowrap' }}>{rounds.length > 1 ? `${round}. kör` : 'járat'}</span>
                                    )}
                                    <span className="row" style={{ gap: 3 }}>
                                      {boxDay && activeRoutes.length > 0 && (
                                        // Melyik járatot viszi (R, G, I…)
                                        <select className="select" value={s?.route_id ?? ''} disabled={busy || isArchived(carId)} title="Járat"
                                          style={{ minHeight: 20, height: 20, padding: '0 16px 0 4px', fontSize: 10, borderRadius: 6, width: 'auto', maxWidth: 70, fontWeight: 700 }}
                                          onChange={(e) => void setCell(carId, d, round, 'route_id', e.target.value)}>
                                          <option value="">— járat —</option>
                                          {(() => { const taken = takenRoutes(d, round, carId); return activeRoutes.map((r) => { const by = taken.get(r.id); return <option key={r.id} value={r.id} disabled={!!by}>{by ? `${r.code} — ${by}` : r.code}</option> }) })()}
                                          {s?.route_id && !activeRoutes.some((r) => r.id === s.route_id) && <option value={s.route_id}>{routeCode(s.route_id) ?? '?'}</option>}
                                        </select>
                                      )}
                                      {round === 2 && (() => {
                                        const r1 = shiftAt(carId, d, 1)
                                        const can = !!(r1?.driver_id || r1?.loader_id) && !s?.driver_id && !s?.loader_id
                                        return can ? (
                                          // Egy koppintás: az 1. kör embere(i) a 2. körre is
                                          <button type="button" disabled={busy || isArchived(carId)} title="Az 1. kör embere a 2. körre is"
                                            style={{ border: '1px solid var(--border)', background: 'var(--primary-ghost)', color: 'var(--primary)', borderRadius: 6, height: 20, padding: '0 5px', fontSize: 9, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 2 }}
                                            onClick={() => void setCell(carId, d, 2, 'driver_id', r1!.driver_id ?? '', { loader_id: r1!.loader_id ?? null })}>
                                            <Icon name="arrow-down" size={10} />mint az 1.
                                          </button>
                                        ) : null
                                      })()}
                                    </span>
                                  </div>
                                )}
                                {fields.map((field, fi) => {
                                  const val = s?.[field] ?? ''
                                  const dup = !!val && dupSet.has(`${d}|${val}`)
                                  return (
                                    <div key={field} style={{ marginBottom: fi < fields.length - 1 ? 3 : 0 }}>
                                      <PersonPicker
                                        compact
                                        value={val}
                                        options={memberOptions}
                                        fallbackLabel={val && members && !memberIdSet.has(val) ? `${goneNames?.[val] ?? 'Ismeretlen'} — letiltva` : undefined}
                                        placeholder={FIELD_PH[field]}
                                        disabled={busy || isArchived(carId)}
                                        danger={dup}
                                        title={dup ? 'Ütközés: aznap másik autóra is be van osztva!' : FIELD_LABEL[field]}
                                        onChange={(id) => void setCell(carId, d, round, field, id)}
                                        inputData={{ 'data-wk': navKey(carId, di, round, field) }}
                                        onNav={(dir) => handleNav(navKey(carId, di, round, field), dir)}
                                      />
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          })}
                        </td>
                      )
                    })}
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {rowMenu && (() => {
          const car = carOf(rowMenu.carId)
          const n = weekShiftsOf(rowMenu.carId).length
          // Csere csak azonos típusra: Box-autó (járatok, körök) csak Box-autóra, XL csak XL-re — a körök/járatok különben elvesznének
          const freeCars = activeCars.filter((c) => c.id !== rowMenu.carId && !rowCarIds.includes(c.id) && isBox(c.id) === isBox(rowMenu.carId))
          return (
            <>
              <div onClick={() => setRowMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 290 }} />
              <div
                className="card stack"
                style={{ position: 'fixed', top: rowMenu.top, left: Math.max(8, Math.min(rowMenu.left, window.innerWidth - 300)), width: 290, zIndex: 300, gap: 8, padding: 12 }}
              >
                <div className="between">
                  <div className="row" style={{ fontWeight: 800, gap: 6 }}><Icon name="truck" size={18} />{car?.plate}</div>
                  <span className="tiny muted">{n} beosztás a héten</span>
                </div>
                {isArchived(rowMenu.carId) && (
                  <div className="alert" style={{ padding: '8px 10px', fontSize: 13, fontWeight: 500, borderLeft: '3px solid var(--warning)' }}>
                    Ez az autó archivált, ezért a sora csak olvasható — új beosztás nem adható rá. Válaszd ki lent az új autót: a hét összes beosztása ({n}) átkerül rá, és a sor szerkeszthető lesz.
                  </div>
                )}
                <div className="field">
                  <label>Csere másik {isBox(rowMenu.carId) ? 'Box-' : 'nem Box-'}autóra (a heti beosztás átkerül)</label>
                  <select className="select" style={selStyle} value="" disabled={rowBusy || freeCars.length === 0}
                    onChange={(e) => { if (e.target.value) void swapCar(rowMenu.carId, e.target.value) }}>
                    <option value="">{freeCars.length === 0 ? `Nincs szabad ${isBox(rowMenu.carId) ? 'Box-' : ''}autó ezen a héten` : '— válassz autót —'}</option>
                    {groupByCategory(freeCars, categories).map((g) => (
                      <optgroup key={g.name} label={g.name}>
                        {g.cars.map((c) => <option key={c.id} value={c.id}>{c.plate}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
                {(() => {
                  const cid = rowMenu.carId
                  const r2 = hasRound2(cid); const n2 = round2Count(cid)
                  const tr = hasTrainee(cid); const nt = traineeCount(cid)
                  return (
                    <div className="stack" style={{ gap: 6 }}>
                      {(isBox(cid) || isMixed(cid)) && <button type="button" className={`btn sm ${r2 ? 'secondary' : 'ghost'}`} disabled={rowBusy || (r2 && n2 > 0)}
                        title={r2 && n2 > 0 ? 'Előbb üresítsd ki a 2. kör mezőit' : undefined}
                        onClick={() => setRoundCars((p) => (r2 ? p.filter((x) => x !== cid) : [...p, cid]))}>
                        <Icon name="repeat" size={14} />{r2 ? `2. kör: bekapcsolva${n2 ? ` (${n2} nap)` : ''}` : '2. kör bekapcsolása (szezon)'}
                      </button>}
                      <button type="button" className={`btn sm ${tr ? 'secondary' : 'ghost'}`} disabled={rowBusy || (tr && nt > 0)}
                        title={tr && nt > 0 ? 'Előbb üresítsd ki a betanuló mezőket' : undefined}
                        onClick={() => setTraineeCars((p) => (tr ? p.filter((x) => x !== cid) : [...p, cid]))}>
                        <Icon name="user" size={14} />{tr ? `Betanuló mező: bekapcsolva${nt ? ` (${nt} nap)` : ''}` : 'Betanuló mező mutatása'}
                      </button>
                    </div>
                  )
                })()}
                <ConfirmButton className="btn danger sm" confirmLabel={n > 0 ? `Igen, ${n} beosztás törlése` : 'Igen, kiveszem'} disabled={rowBusy}
                  onConfirm={() => void removeCarFromWeek(rowMenu.carId)}>
                  Kivétel a hétből{n > 0 ? ` (${n} beosztás törlődik)` : ''}
                </ConfirmButton>
                <button className="btn ghost sm" onClick={() => setRowMenu(null)}>Mégse</button>
              </div>
            </>
          )
        })()}

        <select
          className="select"
          style={{ ...selStyle, maxWidth: 320 }}
          value=""
          onChange={(e) => { if (e.target.value) setAddedCars((p) => [...p, e.target.value]) }}
        >
          <option value="">+ Autó hozzáadása a heti táblázathoz…</option>
          {groupByCategory(activeCars.filter((c) => !rowCarIds.includes(c.id)), categories).map((g) => (
            <optgroup key={g.name} label={g.name}>
              {g.cars.map((c) => (
                <option key={c.id} value={c.id}>{c.plate}{c.label ? ` · ${c.label}` : ''}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="tiny muted">
          A cella azonnal mentődik. Piros keret = az ember aznap másik autóra is be van osztva.
          Billentyűzettel: <strong>Tab</strong> a következő napra lép, <strong>Shift+Tab</strong> vissza, <strong>Enter</strong> az alatta lévő névre — a begépelt név első találatát közben kiválasztja. Mező kiürítése törli a napi beosztást. A rendszámra koppintva: autó cseréje / kivétele, <strong>betanuló</strong> mező, Box-autónál <strong>2. kör</strong> (szezon, akár más emberrel). Box-autónál a 2. körnél a „mint az 1.” gomb átmásolja az 1. kör emberét, a kör neve (R, G, I…) a kis legördülőből választható. <strong>Vegyes</strong> (kategória nélküli) autónál a cella tetején naponként váltható, hogy aznap <strong>Box</strong> vagy <strong>XL</strong>: Box napon van járat és 2. kör. Görgethető oldalra →
        </div>
      </div>

      {(weekSwitches?.length ?? 0) > 0 && (
        <div className="card stack">
          <div className="card-title"><Icon name="repeat" />Napközbeni autócserék ezen a héten</div>
          {weekSwitches!.map((g) => (
            <div key={`${g.userId}|${g.date}`} className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <div className="small" style={{ fontWeight: 700 }}>{formatDate(g.date)} · {g.name}</div>
              <CarTimeline entries={g.entries} />
            </div>
          ))}
        </div>
      )}

      <CrewDaysCard title="Napok ezen a héten" rows={weekCounts} />
    </>
  )
}
