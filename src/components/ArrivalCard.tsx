import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { submitNow } from '../lib/outbox'
import { getCurrentPosition, isOutsideGeofence } from '../lib/geo'
import { todayISO } from '../lib/labels'
import { toast } from '../lib/toast'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

// "Alzába érkeztem": egy koppintás rögzíti az érkezést (idő + GPS — a vezetők
// az Áttekintésben látják), és megnyitja a WhatsAppot. Ha a munkaterületen be
// van állítva a csoport meghívó-linkje, egyből a CSOPORT nyílik, és az üzenet
// a vágólapra kerül (beillesztés + küldés); link nélkül a csoport-választó
// nyílik a kész szöveggel. (A WhatsApp csoporthoz nem enged előre kitöltött
// szöveget linkből, ezért a vágólap.)
const arrivalText = (at: Date, name: string) =>
  `Megérkeztem az Alzába – ${at.toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' })} ${at.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })} – ${name}`
const waUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`

// Vágólapra másolás a koppintás pillanatában (csak felhasználói érintésre működik)
function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false)
  } catch { /* alább a tartalék */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); ta.remove()
    return Promise.resolve(ok)
  } catch { return Promise.resolve(false) }
}

export default function ArrivalCard() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const qc = useQueryClient()
  const date = todayISO()
  const name = profile?.full_name || profile?.email || 'Munkatárs'
  const groupLink = currentWorkspace?.arrival_whatsapp_group ?? null
  const groupName = currentWorkspace?.arrival_whatsapp_group_name ?? null
  // Csoport-linkkel a csoport nyílik (szöveg a vágólapon), anélkül a választó a szöveggel
  const targetUrl = (text: string) => groupLink ?? waUrl(text)

  const { data: arrival, isLoading } = useQuery({
    queryKey: ['arrival', currentWorkspaceId, profile?.id, date],
    enabled: !!currentWorkspaceId && !!profile,
    queryFn: async () => {
      const { data, error } = await supabase.from('arrivals').select('id, arrived_at')
        .eq('workspace_id', currentWorkspaceId!).eq('user_id', profile!.id).eq('work_date', date).maybeSingle()
      if (error) throw error
      return data
    },
  })

  // A WhatsApp-link maga a gomb (natív megnyitás az érintésre) — a rögzítés
  // a háttérben megy, offline is sorba áll.
  async function logArrival() {
    if (!currentWorkspaceId || !profile || arrival) return
    const at = new Date()
    try {
      const gps = await getCurrentPosition(4000)
      const outside = currentWorkspace ? isOutsideGeofence(gps, currentWorkspace) : false
      const id = crypto.randomUUID()
      await submitNow({
        id, table: 'arrivals', op: 'insert', label: 'Érkezés jelzése',
        values: { id, workspace_id: currentWorkspaceId, user_id: profile.id, work_date: date, arrived_at: at.toISOString(), gps_lat: gps.lat, gps_lng: gps.lng, outside_geofence: outside },
      })
      toast.success(groupLink ? 'Érkezés rögzítve — a csoportban: beillesztés, majd küldés.' : 'Érkezés rögzítve — a WhatsAppban válaszd ki a csoportot és küldd el.')
      void qc.invalidateQueries({ queryKey: ['arrival'] })
    } catch (e) {
      toast.error('Az érkezés rögzítése nem sikerült: ' + (e instanceof Error ? e.message : 'ismeretlen hiba'))
    }
  }

  async function undo() {
    if (!arrival) return
    const { error } = await supabase.from('arrivals').delete().eq('id', arrival.id)
    if (error) { toast.error('Nem sikerült visszavonni: ' + error.message); return }
    toast.info('Érkezés visszavonva.')
    void qc.invalidateQueries({ queryKey: ['arrival'] })
  }

  if (isLoading) return null
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })

  if (arrival) {
    return (
      <div className="card stack" style={{ gap: 8, borderColor: 'var(--success)' }}>
        <div className="between">
          <span className="badge success"><Icon name="map-pin" />Megérkeztél {hhmm(arrival.arrived_at)}</span>
          <ConfirmButton className="btn ghost sm auto" confirmLabel="Visszavonás?" onConfirm={() => void undo()}>
            <Icon name="x" size={14} />Visszavonás
          </ConfirmButton>
        </div>
        <a className="btn ghost sm" href={targetUrl(arrivalText(new Date(arrival.arrived_at), name))} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}
          onClick={() => { if (groupLink) void copyText(arrivalText(new Date(arrival.arrived_at), name)).then((ok) => { if (ok) toast.info('Üzenet a vágólapon — a csoportban illeszd be és küldd el.') }) }}>
          <Icon name="send" size={16} />{groupLink ? `${groupName ?? 'Csoport'} megnyitása (üzenet a vágólapon)` : 'WhatsApp-üzenet újra megnyitása'}
        </a>
      </div>
    )
  }

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <a className="btn" href={targetUrl(arrivalText(new Date(), name))} target="_blank" rel="noopener noreferrer"
        style={{ textDecoration: 'none' }}
        // Az üzenet ideje a KOPPINTÁS pillanata (nem a kezdőlap betöltéséé) —
        // a href-et a navigáció előtt frissítjük; csoport-linknél a szöveg a vágólapra megy
        onClick={(e) => {
          const text = arrivalText(new Date(), name)
          e.currentTarget.href = targetUrl(text)
          if (groupLink) void copyText(text)
          void logArrival()
        }}>
        <Icon name="map-pin" />Alzába érkeztem
      </a>
      {groupLink && (
        <div className="tiny row" style={{ gap: 6, justifyContent: 'center' }}>
          <Icon name="send" size={14} style={{ color: 'var(--success)' }} /><span className="muted">WhatsApp-csoport:</span><strong>{groupName ?? 'beállítva'}</strong>
        </div>
      )}
      <p className="tiny muted" style={{ margin: 0, textAlign: 'center' }}>
        {groupLink
          ? 'Rögzíti az érkezés idejét (a vezetők látják), és megnyitja a csoportot — az üzenet a vágólapon: nyomd hosszan a beviteli mezőt, Beillesztés, Küldés.'
          : 'Rögzíti az érkezés idejét (a vezetők látják), és megnyitja a WhatsAppot a kész üzenettel — ott válaszd ki a csoportot és küldd el.'}
      </p>
    </div>
  )
}
