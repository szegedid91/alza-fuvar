import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToday } from '../hooks/useToday'
import { submitNow } from '../lib/outbox'
import { getCurrentPosition, isOutsideGeofence } from '../lib/geo'
import { useTodayStatusEvents } from '../lib/statusEvents'
import { toast } from '../lib/toast'
import { errMsg } from '../lib/errors'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

// A nap vége: „Autó lerakva” (elektromosnál: „és töltőre téve”). Csak az
// „Elszámoltam” jelzés UTÁN aktív — ez zárja le a napot (a becsekkolás
// checked_out_at-ja, idővel, GPS-szel, geofence-jelzéssel). Külön
// „Kijelentkezés” gomb nincs: vagy így ér véget a nap, vagy autócserével
// (a Beolvasás oldalon), vagy napközben mások ülnek át az ő autójára.
export function useSettledToday() {
  return useTodayStatusEvents((rows) => rows.find((r) => r.kind === 'settled')?.at ?? null)
}

export default function ParkCarButton({ className = 'btn' }: { className?: string }) {
  const { currentWorkspace } = useWorkspace()
  const { data: today } = useToday()
  const { data: settledAt, isLoading } = useSettledToday()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const checkin = today?.checkin ?? null
  const electric = today?.car?.fuel_type === 'electric'
  const label = electric ? 'Autó lerakva, töltőre téve' : 'Autó lerakva'

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
      toast.success(electric ? 'Nap lezárva — autó lerakva, töltőn. Szép munka!' : 'Nap lezárva — autó lerakva. Szép munka!')
      await qc.invalidateQueries({ queryKey: ['today'] })
    } catch (e) {
      toast.error('Nem sikerült lezárni a napot: ' + errMsg(e, 'ismeretlen hiba'))
    } finally {
      setBusy(false)
    }
  }

  if (!checkin || checkin.checked_out_at) return null
  const ready = !!settledAt
  return (
    <div className="stack" style={{ gap: 6 }}>
      <ConfirmButton className={className} confirmLabel={electric ? 'Biztos? Lerakva és töltőn' : 'Biztos? Lerakva'} disabled={!ready || busy || isLoading} onConfirm={() => void park()}
        style={ready ? undefined : { opacity: 0.55 }}>
        <Icon name={electric ? 'zap' : 'flag'} />{busy ? 'Mentés…' : label}
      </ConfirmButton>
      <div className="tiny muted" style={{ textAlign: 'center' }}>
        {ready
          ? (electric ? 'Elszámoltál. Tedd töltőre az autót, és koppints — ezzel zárul a nap.' : 'Elszámoltál. Rakd le az autót, és koppints — ezzel zárul a nap.')
          : 'Előbb az „Elszámoltam” jelzés a csoportba — utána aktív.'}
      </div>
    </div>
  )
}
