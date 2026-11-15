import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { todayISO } from '../lib/labels'
import { getCrewForDay, countInspectionsToday, traineeScheduled, type CarWithCategory, type CrewMember } from '../lib/checkin'
import type { Tables } from '../lib/database.types'
import { useWorkDay } from './useWorkDay'
import { clearWorkDayPin, isAfterCutover, pinnedWorkDay, pinWorkDay } from '../lib/workDay'

export interface TodayState {
  date: string
  checkin: Tables<'check_ins'> | null
  car: CarWithCategory | null
  crew: CrewMember[]
  // A mai beosztott szerep a beosztásból (nem a profilból) — a menedzser dönti el.
  assignedRole: 'driver' | 'loader' | 'trainee' | null
  // Van-e ma betanuló beosztva a mai autóra (a Box 1 fős létszáma ilyenkor +1)
  traineeOnCar: boolean
  // A mai beosztás szerinti autó és járat — becsekkolás ELŐTT is tudjuk, mire van beosztva
  // isBox: a beosztott autó Box-kategóriás-e (null = nem tudni) — a beolvasásnál csak ilyen kategóriájú autó választható
  planned: { plate: string; label: string | null; routeCode: string | null; round: number | null; isBox: boolean | null } | null
  // A becsekkolás teljessége: van-e MA ellenőrző fotósor az autón (bárkitől).
  // Fotó nélkül csak vezetői továbbengedéssel (checkin.inspection_waived_at) mehet tovább a nap.
  inspectionDone: boolean
}

// Az aktuális felhasználó mai becsekkolása az aktuális munkaterületen.
export function useToday() {
  const { profile } = useAuth()
  const { currentWorkspaceId } = useWorkspace()
  // a futár MUNKANAPJA (este 18:00-kor vált, a nyitott becsekkolás megtartja) — nem a naptári nap
  const workDay = useWorkDay()

  return useQuery<TodayState>({
    queryKey: ['today', currentWorkspaceId, profile?.id, workDay, 'v3'],
    enabled: !!currentWorkspaceId && !!profile?.id,
    queryFn: async () => {
      const uid = profile!.id
      // Este 6 után a munkanap már a holnapi. Ha a futárnak a naptári MAI napon még NYITOTT becsekkolása van
      // (nappalos, aki 18:00 után is dolgozik) és a telefonon nincs rögzítve, ahhoz a naphoz kötjük.
      let date = workDay
      if (!pinnedWorkDay() && isAfterCutover()) {
        const cal = todayISO()
        if (cal !== date) {
          const { data: open } = await supabase.from('check_ins').select('id')
            .eq('workspace_id', currentWorkspaceId!).eq('user_id', uid).eq('work_date', cal).is('checked_out_at', null).limit(1)
          if (open && open.length > 0) { pinWorkDay(cal, uid); date = cal }
        }
      }
      // A két lekérdezés független — párhuzamosan futnak.
      // FONTOS: limit(1) nélkül a maybeSingle() több sor esetén (pl. napközbeni
      // autóváltás = két becsekkolás) hibát ad és "nincs becsekkolva"-t mutatna.
      // FK-hint kötelező: a check_ins-nek KÉT cars-hivatkozása van
      // (car_id és prev_car_id) — enélkül a PostgREST hibát ad (PGRST201).
      const [{ data: ci, error: ciErr }, { data: shift, error: shErr }] = await Promise.all([
        supabase
          .from('check_ins')
          .select('*, car:cars!check_ins_car_id_fkey(*, category:car_categories(name, crew_size, box_sheet))')
          .eq('workspace_id', currentWorkspaceId!)
          .eq('user_id', profile!.id)
          .eq('work_date', date)
          .order('checked_out_at', { ascending: true, nullsFirst: true })
          .order('checked_in_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('shifts')
          .select('driver_id, loader_id, trainee_id, round, car:cars(plate, label, category:car_categories(box_sheet)), route:route_names(code)')
          .eq('workspace_id', currentWorkspaceId!)
          .eq('work_date', date)
          .or(`driver_id.eq.${profile!.id},loader_id.eq.${profile!.id},trainee_id.eq.${profile!.id}`)
          .order('round') // LOG-26: kétkörös napon az 1. kör a „tervezett”, ne véletlenszerű
          .limit(1)
          .maybeSingle(),
      ])
      // Hibát DOBNI kell — elnyelve "nincs becsekkolva"-nak látszana, és a
      // munkatárs duplán csekkolna be / a kapuk tévesen zárnának.
      if (ciErr) throw ciErr
      if (shErr) throw shErr

      const row = ci as unknown as (Tables<'check_ins'> & { car: CarWithCategory | null }) | null
      const checkin = row ? ({ ...row, car: undefined } as unknown as Tables<'check_ins'>) : null
      const car = row?.car ?? null
      const [crew, inspCount, traineeOnCar] = car
        ? await Promise.all([getCrewForDay(car.id, date), countInspectionsToday(car.id, date), traineeScheduled(car.id, date)])
        : [[], 0, false]

      // Mai beosztott szerep a shiftből
      const assignedRole: 'driver' | 'loader' | 'trainee' | null =
        shift?.driver_id === profile!.id ? 'driver' : shift?.loader_id === profile!.id ? 'loader' : shift?.trainee_id === profile!.id ? 'trainee' : null

      const plannedCar = (shift?.car as unknown as { plate: string; label: string | null; category: { box_sheet: boolean } | null } | null) ?? null
      const plannedRoute = (shift?.route as unknown as { code: string } | null) ?? null
      const planned = plannedCar ? { plate: plannedCar.plate, label: plannedCar.label, routeCode: plannedRoute?.code ?? null, round: shift?.round ?? null, isBox: plannedCar.category?.box_sheet ?? null } : null

      // Rögzítés: amíg a becsekkolás nyitott, a munkanap ez a nap marad (éjfélkor és 18:00-kor sem vált);
      // lezárt nap (autó lerakva) vagy hiányzó becsekkolás után a váltás szerinti nap él
      if (checkin && !checkin.checked_out_at) pinWorkDay(date, uid)
      else if (pinnedWorkDay() === date) clearWorkDayPin()
      return { date, checkin, car, crew, assignedRole, inspectionDone: inspCount > 0, traineeOnCar, planned }
    },
  })
}
