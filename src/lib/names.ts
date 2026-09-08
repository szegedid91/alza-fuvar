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

// Név + telefonszám feloldása (beosztásnál a társ egy koppintással hívható).
// A profiles-t az RLS elrejti a munkatársak elől — ez az RPC csak nevet és
// telefonszámot ad vissza, a saját munkaterületen belül.
export async function resolveContacts(
  ids: (string | null | undefined)[],
): Promise<Record<string, { name: string | null; phone: string | null }>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))]
  if (unique.length === 0) return {}
  const { data, error } = await supabase.rpc('resolve_member_contacts', { ids: unique })
  if (error) {
    console.error('Kapcsolat feloldási hiba:', error.message)
    return {}
  }
  const map: Record<string, { name: string | null; phone: string | null }> = {}
  for (const r of data ?? []) map[r.id] = { name: r.full_name, phone: r.phone }
  return map
}

// Telefonszám hívható formára: szóközök/kötőjelek nélkül
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null
  const clean = phone.replace(/[^\d+]/g, '')
  return clean.length >= 6 ? `tel:${clean}` : null
}
