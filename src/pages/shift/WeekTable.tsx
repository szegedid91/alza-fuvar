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
import { todayISO, formatDate } from '../../lib/labels'
import { addDays, mondayOf, crewSizeFor, groupByCategory, DAY_NAMES_LONG, weekLabel } from '../../lib/calendar'
import Icon from '../../components/Icon'
import type { Tables } from '../../lib/database.types'

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
    for (const s of shifts ?? []) if (s.work_date === date && (s.round ?? 1) === round && s.route_id && s.car_id !== exceptCarId) m.set(s.route_id, carOf(s.car_id)?.plate ?? '?')
    return m
  }
  const [addedCars, setAddedCars] = useState<string[]>([])
  const memberOptions = useMemo(() => (members ?? []).map((m) => ({ id: m.id, label: m.full_name || m.email || '—' })), [members])
  const [error, setError] = useState<string | null>(null)
  const [busyCell, setBusyCell] = useState<string | null>(null)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)
  // Sor-menü (autó cseréje / kivétele a hétből)
  const [rowMenu, setRowMenu] = useState<{ carId: string; top: number; left: number } | null>(null)
  const [rowBusy, setRowBusy] = useState(false)

  const { data: shifts } = useQuery({
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

  const shiftAt = (carId: string, date: string, round = 1) =>
    (shifts ?? []).find((s) => s.car_id === carId && s.work_date === date && (s.round ?? 1) === round)

  // Sor-módok: 2. kör (szezon) és betanuló mező — kézzel bekapcsolva, vagy ha a
  // héten már van ilyen adat az autónál, automatikusan
  const [roundCars, setRoundCars] = useState<string[]>([])
  const [traineeCars, setTraineeCars] = useState<string[]>([])
  const hasRound2 = (carId: string) => isBox(carId) && (roundCars.includes(carId) || (shifts ?? []).some((s) => s.car_id === carId && s.round === 2))
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
  const isArchived = (carId: string) => (cars ?? []).find((c) => c.id === carId)?.active === false
  const categoryName = (id: string | null) => (categories ?? []).find((c) => c.id === id)?.name ?? null
  const crewOf = (carId: string) => crewSizeFor(cars, categories, carId)
  // Körök (1./2. kör, kör-nevek) csak a Box-kategóriás (AlzaBox-töltő) autóknál vannak — XL-nél nincs
  const isBox = (carId: string) => {
    const car = (cars ?? []).find((c) => c.id === carId)
    return !!(categories ?? []).find((k) => k.id === car?.category_id)?.box_sheet
  }
  // A cella mezői: sofőr, (rakodó — 2 fős kategória vagy ha be van töltve),
  // (betanuló — ha a sor betanuló-módban van vagy be van töltve)
  const fieldsOf = (carId: string, s?: Shift): Field[] => {
    const f: Field[] = ['driver_id']
    if (crewOf(carId) === 2 || s?.loader_id) f.push('loader_id')
    if (hasTrainee(carId) || s?.trainee_id) f.push('trainee_id')
    return f
  }
  // A sor magassága a hét legmagasabb cellájához igazodik (a két tábla
  // sormagassága különben szétcsúszna)
  const rowH = (carId: string) => {
    const rounds = hasRound2(carId) ? 2 : 1
    const maxFields = Math.max(...days.map((d) => Math.max(...[1, 2].map((r) => fieldsOf(carId, shiftAt(carId, d, r)).length))))
    const header = rounds > 1 || (isBox(carId) && activeRoutes.length > 0) ? ROUND_LABEL_H + 10 : 0
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

  // Fejenkénti napszám ezen a héten (mint a táblázat K–L oszlopa)
  const weekCounts = useMemo(() => {
    const byUser = new Map<string, Set<string>>()
    for (const s of shifts ?? []) {
      for (const uid of [s.driver_id, s.loader_id, s.trainee_id]) {
        if (!uid) continue
        if (!byUser.has(uid)) byUser.set(uid, new Set())
        byUser.get(uid)!.add(s.work_date)
      }
    }
    // Minden nem-admin/nem-menedzser tag felsorolva (0 nappal is);
    // admin/menedzser csak akkor, ha ténylegesen be van osztva a héten
    return (members ?? [])
      .filter((m) => (m.role !== 'admin' && m.role !== 'manager') || (byUser.get(m.id)?.size ?? 0) > 0)
      .map((m) => ({
        id: m.id, name: m.full_name || m.email || '—', count: byUser.get(m.id)?.size ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [shifts, members])

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

  async function setCell(carId: string, date: string, round: number, field: Field | 'route_id', value: string, extra?: Partial<Pick<Shift, 'driver_id' | 'loader_id' | 'trainee_id'>>) {
    if (!currentWorkspaceId || !profile) return
    setError(null)
    setBusyCell(`${carId}|${date}`)
    try {
      const cur = shiftAt(carId, date, round)
      const next = {
        driver_id: cur?.driver_id ?? null, loader_id: cur?.loader_id ?? null, trainee_id: cur?.trainee_id ?? null,
        route_id: cur?.route_id ?? null,
        [field]: value || null,
        ...(extra ?? {}),
      }
      if (!next.driver_id && !next.loader_id && !next.trainee_id) {
        // Minden mező üres → a napi (köri) beosztás törlődik
        if (cur) {
          const { error } = await supabase.from('shifts').delete().eq('id', cur.id)
          if (error) throw error
        }
      } else {
        const { error } = await supabase.from('shifts').upsert({
          workspace_id: currentWorkspaceId, work_date: date, car_id: carId, round,
          ...next, created_by: profile.id,
        }, { onConflict: 'car_id,work_date,round' })
        if (error) throw error
      }
      await qc.invalidateQueries({ queryKey: ['shift-week'] })
      await qc.invalidateQueries({ queryKey: ['shift-cal'] })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Mentési hiba'
      setError(/ROUTE_TAKEN/.test(msg) ? msg.replace(/^.*ROUTE_TAKEN:\s*/, 'Nem menthető: ') : msg)
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
    }))
    const { error } = await supabase.from('shifts').upsert(rows, { onConflict: 'car_id,work_date,round' })
    if (error) { setError(error.message); return }
    setCopyMsg(`${rows.length} beosztás átmásolva az előző hétről.`)
    await qc.invalidateQueries({ queryKey: ['shift-week'] })
    await qc.invalidateQueries({ queryKey: ['shift-cal'] })
  }

  const carOf = (id: string) => (cars ?? []).find((c) => c.id === id)

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
      setError(e instanceof Error ? e.message : 'Az autó cseréje nem sikerült')
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
      setError(e instanceof Error ? e.message : 'Az autó kivétele nem sikerült')
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
      setPublishMsg('Hiba a kiküldésnél: ' + (e instanceof Error ? e.message : 'ismeretlen'))
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
          <ConfirmButton className="btn secondary sm" confirmLabel="Másolás (felülír)" onConfirm={() => void copyPrevWeek()}><Icon name="clipboard" />Előző hét másolása</ConfirmButton>
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
                    <td className="wk-catcol" rowSpan={groupSpan(rowIdx)} title={categoryName(rowCars[rowIdx].category_id) ?? 'Nincs kategória'}>
                      {categoryName(rowCars[rowIdx].category_id) ?? '—'}
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
                      <span>{carOf(carId)?.plate ?? '?'}{isArchived(carId) && <span className="tiny muted" style={{ fontWeight: 500, marginLeft: 4 }}>(archivált)</span>}</span>
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
                    {days.map((d) => {
                      const busy = busyCell === `${carId}|${d}`
                      const rowBg = rowIdx % 2 ? 'var(--bg-elev-2)' : 'var(--bg)'
                      const rounds = hasRound2(carId) ? [1, 2] : [1]
                      return (
                        <td key={d} style={{ verticalAlign: 'top', background: d === today ? 'rgba(20,184,166,.10)' : rowBg, borderRadius: 8, padding: 4, opacity: busy ? 0.55 : 1 }}>
                          {rounds.map((round) => {
                            const s = shiftAt(carId, d, round)
                            // 1 fős kategória: csak sofőr-mező (a rakodó/betanuló akkor is látszik, ha be van töltve, hogy törölhető legyen)
                            const fields = fieldsOf(carId, s)
                            return (
                              <div key={round} style={{ marginBottom: round < rounds.length ? 6 : 0 }}>
                                {(rounds.length > 1 || (isBox(carId) && activeRoutes.length > 0)) && (
                                  <div className="between" style={{ gap: 4, minHeight: ROUND_LABEL_H + 10, marginBottom: 2 }}>
                                    <span className="tiny muted" style={{ fontSize: 9, fontWeight: 700, paddingLeft: 2, whiteSpace: 'nowrap' }}>{rounds.length > 1 ? `${round}. kör` : 'járat'}</span>
                                    <span className="row" style={{ gap: 3 }}>
                                      {isBox(carId) && activeRoutes.length > 0 && (
                                        // Melyik járatot viszi (R, G, I…)
                                        <select className="select" value={s?.route_id ?? ''} disabled={busy || isArchived(carId)} title="Járat"
                                          style={{ minHeight: 20, height: 20, padding: '0 16px 0 4px', fontSize: 10, borderRadius: 6, width: 'auto', maxWidth: 70, fontWeight: 700 }}
                                          onChange={(e) => void setCell(carId, d, round, 'route_id', e.target.value)}>
                                          <option value="">— járat —</option>
                                          {activeRoutes.map((r) => { const by = takenRoutes(d, round, carId).get(r.id); return <option key={r.id} value={r.id} disabled={!!by}>{by ? `${r.code} — ${by}` : r.code}</option> })}
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
                                        placeholder={FIELD_PH[field]}
                                        disabled={busy || isArchived(carId)}
                                        danger={dup}
                                        title={dup ? 'Ütközés: aznap másik autóra is be van osztva!' : FIELD_LABEL[field]}
                                        onChange={(id) => void setCell(carId, d, round, field, id)}
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
          const freeCars = activeCars.filter((c) => c.id !== rowMenu.carId && !rowCarIds.includes(c.id))
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
                <div className="field">
                  <label>Csere másik autóra (a heti beosztás átkerül)</label>
                  <select className="select" style={selStyle} value="" disabled={rowBusy || freeCars.length === 0}
                    onChange={(e) => { if (e.target.value) void swapCar(rowMenu.carId, e.target.value) }}>
                    <option value="">{freeCars.length === 0 ? 'Nincs szabad autó ezen a héten' : '— válassz autót —'}</option>
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
                      {isBox(cid) && <button type="button" className={`btn sm ${r2 ? 'secondary' : 'ghost'}`} disabled={rowBusy || (r2 && n2 > 0)}
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
          Mező kiürítése törli a napi beosztást. A rendszámra koppintva: autó cseréje / kivétele, <strong>betanuló</strong> mező, Box-autónál <strong>2. kör</strong> (szezon, akár más emberrel). Box-autónál a 2. körnél a „mint az 1.” gomb átmásolja az 1. kör emberét, a kör neve (R, G, I…) a kis legördülőből választható. Görgethető oldalra →
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

      <div className="card stack">
        <div className="card-title"><Icon name="users" />Napok ezen a héten</div>
        {weekCounts.length === 0 && <div className="tiny muted">Nincs munkatárs ezen a munkaterületen.</div>}
        <div className="grid-2">
          {weekCounts.map((r) => (
            <div key={r.id} className="between">
              <span className="small" style={{ fontWeight: r.count > 0 ? 700 : 400, color: r.count === 0 ? 'var(--text-dim)' : undefined }}>{r.name}</span>
              <span className={`badge ${r.count > 0 ? 'primary' : ''}`}>{r.count}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
