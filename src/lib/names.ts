import { supabase } from './supabase'

// Nevek feloldása id -> full_name a member_names nézetből (RLS-biztos, csak nevek).
export async function resolveNames(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))]
  if (unique.length === 0) return {}
  const { data, error } = await supabase.rpc('resolve_member_names', { ids: unique })
  if (error) {
    console.error('Név feloldási hiba:', error.message)
    return {}
  }
  const map: Record<string, string> = {}
  for (const r of data ?? []) if (r.full_name) map[r.id] = r.full_name
  return map
}
