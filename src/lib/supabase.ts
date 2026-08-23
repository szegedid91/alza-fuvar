import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anon) {
  // Segítő hibaüzenet fejlesztés közben
  console.error('Hiányzó VITE_SUPABASE_URL vagy VITE_SUPABASE_ANON_KEY (.env.local)')
}

export const supabase = createClient<Database>(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'alza-auth',
  },
})
