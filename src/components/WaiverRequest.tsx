import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/toast'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

// "Nem tudok fotózni" — a munkatárs jelzi a vezetőknek (push), akik az
// Áttekintésben a saját fiókjukból engedhetik tovább fotó nélkül.
export default function WaiverRequest({ checkinId, requestedAt }: { checkinId: string; requestedAt: string | null }) {
  const qc = useQueryClient()
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
  const request = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('check_ins')
        .update({ inspection_help_requested_at: new Date().toISOString() }).eq('id', checkinId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Jeleztük a vezetőknek — amint engedélyezik, folytathatod.')
      void qc.invalidateQueries({ queryKey: ['today'] })
    },
    onError: (e) => toast.error('Nem sikerült jelezni: ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })
  return (
    <div className="stack" style={{ gap: 6 }}>
      {requestedAt && (
        <div className="tiny muted row" style={{ gap: 6 }}>
          <Icon name="bell" size={14} />Engedély kérve {hhmm(requestedAt)} — a vezető az Áttekintésben engedélyezheti. Ha megtörtént, húzd le a frissítéshez.
        </div>
      )}
      <ConfirmButton className="btn ghost sm" confirmLabel="Biztos? Jelzés a vezetőknek" disabled={request.isPending} onConfirm={() => request.mutate()}>
        <Icon name="bell" size={16} />{requestedAt ? 'Újra kérem az engedélyt' : 'Nem tudok fotózni — vezetői engedély kérése'}
      </ConfirmButton>
    </div>
  )
}
