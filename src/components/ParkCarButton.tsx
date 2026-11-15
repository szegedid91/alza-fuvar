import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { submitNow } from '../lib/outbox'
import { getCurrentPosition, isOutsideGeofence } from '../lib/geo'
import { useTodayStatusEvents } from '../lib/statusEvents'
import { useMyRoutesToday } from '../hooks/useMyRoutesToday'
import { dayComplete } from '../lib/rounds'
import { useFuelGate } from '../hooks/useDayEnd'
import { toast } from '../lib/toast'
import { errMsg } from '../lib/errors'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

// A nap vége: „Autó lerakva” (elektromosnál: „és töltőre téve”). Csak az
// „Elszámoltam” jelzés UTÁN aktív — ez zárja le a napot (a becsekkolás
// checked_out_at-ja, idővel, GPS-szel, geofence-jelzéssel). Külön
// „Kijelentkezés” gomb nincs: az autó lerakása EGYBEN a kijelentkezés az autóról. Vagy így ér véget a nap, vagy autócserével
// (a Beolvasás oldalon), vagy napközben mások ülnek át az ő autójára.
// Elszámolva = a nap kész: minden kör „Járat kész”, és az UTOLSÓ után is megvolt az elszámolás
// (két körnél az első kör elszámolása még nem zárja a napot — addig nincs „Autó lerakva”)
export function useSettledToday(): { data: string | null; isLoading: boolean } {
  const { data: events, isLoading } = useTodayStatusEvents()
  const { data: myRoutes } = useMyRoutesToday()
  if (!events || !myRoutes) return { data: null, isLoading: isLoading || !myRoutes }
  const done = dayComplete(myRoutes.length, events)
  const last = [...events].reverse().find((e) => e.kind === 'settled')?.at ?? null
  return { data: done ? last : null, isLoading: false }
}

export default function ParkCarButton({ className = 'btn' }: { className?: string }) {
  const { currentWorkspace } = useWorkspace()
  const { data: today } = useToday()
  const { data: settledAt, isLoading } = useSettledToday()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  // LOG-25: offline sorba állás után is eltűnik a gomb — ne lehessen kétszer lezárni
  const [parked, setParked] = useState<string | null>(null)
  const checkin = today?.checkin ?? null
  const electric = today?.car?.fuel_type === 'electric'
  const label = electric ? 'Autó lerakva, töltőre téve' : 'Autó lerakva'
  // dízel / benzines autónál előbb a tankolás (blokk fotóval), vagy a „ma nem tankoltam” jelzés
  const fuelGate = useFuelGate(today?.car ?? null, today?.date ?? '')

  async function park() {
    if (!checkin) return
    setBusy(true)
    try {
      const gps = await getCurrentPosition()
      const outside = currentWorkspace ? isOutsideGeofence(gps, currentWorkspace) : false
      await submitNow({
        id: crypto.randomUUID(), table: 'check_ins', op: 'update', match: { id: checkin.id },
        label: `${label} – nap vége`,
        values: { checked_out_at: new Date().toISOString(), out_gps_lat: gps.lat, out_gps_lng: gps.lng, out_outside_geofence: outside },
      })
      setParked(checkin.id)
      toast.success(electric ? 'Nap lezárva — autó lerakva, töltőn. Kijelentkeztél az autóról. Szép munka!' : 'Nap lezárva — autó lerakva. Kijelentkeztél az autóról. Szép munka!')
      await qc.invalidateQueries({ queryKey: ['today'] })
    } catch (e) {
      toast.error('Nem sikerült lezárni a napot: ' + errMsg(e, 'ismeretlen hiba'))
    } finally {
      setBusy(false)
    }
  }

  if (!checkin || checkin.checked_out_at || parked === checkin.id) return null
  const settledOk = !!settledAt
  const ready = settledOk && fuelGate.ok
  return (
    <div className="stack" style={{ gap: 6 }}>
      <ConfirmButton className={className} confirmLabel={electric ? 'Biztos? Lerakva és töltőn' : 'Biztos? Lerakva'} disabled={!ready || busy || isLoading || fuelGate.isLoading} onConfirm={() => void park()}
        style={ready ? undefined : { opacity: 0.55 }}>
        <Icon name={electric ? 'zap' : 'flag'} />{busy ? 'Mentés…' : label}
      </ConfirmButton>
      <div className="tiny muted" style={{ textAlign: 'center' }}>
        {ready
          ? (electric ? 'Tedd töltőre az autót, és koppints — ezzel zárul a nap, és kijelentkezel az autóról.' : 'Rakd le az autót, és koppints — ezzel zárul a nap, és kijelentkezel az autóról.')
          : !settledOk ? 'Előbb az „Elszámoltam” jelzés a csoportba — utána aktív.'
            : 'Előbb a tankolás (blokk fotóval) — utána aktív.'}
      </div>
    </div>
  )
}
