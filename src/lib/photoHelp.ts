import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAuth } from '../context/AuthContext'
import { toast } from './toast'
import { errMsg } from './errors'
import { resolveNames } from './names'
import { todayISO } from './labels'

// „Nem tudok fotózni” — nyitott vezetői engedélykérések: ma becsekkolt, még nem
// jelentkezett ki, engedélyt kért, de az autó azóta sincs körbefotózva és nincs
// továbbengedve sem. A vezetők kezdőlapján és az Áttekintésben is látszik.
export interface PhotoHelpRequest {
  checkinId: string
  userId: string
  name: string
  plate: string
  helpAt: string
}

export async function findPhotoHelpRequests(workspaceId: string, date: string): Promise<PhotoHelpRequest[]> {
  const { data: cis, error } = await supabase.from('check_ins')
    .select('id, car_id, user_id, inspection_help_requested_at, cars!check_ins_car_id_fkey(plate)')
    .eq('workspace_id', workspaceId).eq('work_date', date)
    .is('checked_out_at', null).is('inspection_waived_at', null).not('inspection_help_requested_at', 'is', null)
  if (error) throw error
  if (!cis || cis.length === 0) return []
  const { data: insp, error: inspErr } = await supabase.from('car_inspections')
    .select('car_id').eq('workspace_id', workspaceId).eq('work_date', date).not('completed_at', 'is', null).in('car_id', cis.map((c) => c.car_id))
  if (inspErr) throw inspErr
  const done = new Set((insp ?? []).map((i) => i.car_id))
  const open = cis.filter((c) => !done.has(c.car_id))
  if (open.length === 0) return []
  const names = await resolveNames(open.map((c) => c.user_id))
  return open.map((c) => ({
    checkinId: c.id, userId: c.user_id, name: names[c.user_id] ?? 'Munkatárs',
    plate: (c.cars as unknown as { plate: string } | null)?.plate ?? '?',
    helpAt: c.inspection_help_requested_at!,
  })).sort((a, b) => a.helpAt.localeCompare(b.helpAt))
}

// 30 mp-enként frissül; a realtime invalidálás ['photo-help'] kulccsal gyorsítja
export function usePhotoHelpRequests(enabled = true) {
  const { currentWorkspaceId } = useWorkspace()
  const date = todayISO()
  return useQuery({
    queryKey: ['photo-help', currentWorkspaceId, date],
    enabled: enabled && !!currentWorkspaceId,
    refetchInterval: 30000,
    queryFn: () => findPhotoHelpRequests(currentWorkspaceId!, date),
  })
}

// Továbbengedés fotó nélkül: a vezető a saját fiókjából engedi tovább (naplózva, a neve
// rákerül a becsekkolásra). A kezdőlap és az Áttekintés ugyanezt használja.
export function useWaiveInspection() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation({
    mutationFn: async (checkinId: string) => {
      const { error } = await supabase.from('check_ins')
        .update({ inspection_waived_at: new Date().toISOString(), inspection_waived_by: profile!.id })
        .eq('id', checkinId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Továbbengedve fotó nélkül — a munkatárs folytathatja.')
      for (const key of [['dashboard'], ['photo-help'], ['home-counts']]) void qc.invalidateQueries({ queryKey: key })
    },
    onError: (e) => toast.error('Nem sikerült: ' + errMsg(e, 'ismeretlen hiba')),
  })
}
