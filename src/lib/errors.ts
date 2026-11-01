// Hibaüzenet kiolvasása bármilyen elkapott értékből. A Supabase (PostgREST) a hibát
// SIMA objektumként adja vissza ({ message, details, hint, code }), nem Error-példányként —
// az `e instanceof Error` ezért hamis volt, és „ismeretlen hiba” jelent meg a valódi
// üzenet (pl. a szerver figyelmeztetése) helyett.
export function errMsg(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message || fallback
  if (typeof e === 'string') return e || fallback
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; error?: unknown; error_description?: unknown; details?: unknown }
    for (const v of [o.message, o.error_description, o.error, o.details]) {
      if (typeof v === 'string' && v.trim()) return v
    }
  }
  return fallback
}
