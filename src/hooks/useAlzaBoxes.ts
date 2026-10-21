import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import type { AlzaBox } from '../lib/boxSheet'

// Az AlzaBox-jegyzék (globális, ~800 sor) — ritkán változik, 10 percig friss.
export function useAlzaBoxes() {
  return useQuery({
    queryKey: ['alza-boxes', 'v1'],
    staleTime: 10 * 60_000,
    queryFn: async () => fetchAll<AlzaBox>((f, t) =>
      supabase.from('alza_boxes').select('*').eq('active', true).order('name').order('id').range(f, t)),
  })
}
