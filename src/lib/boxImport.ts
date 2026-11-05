// Box-jegyzék import: a „megszűnt” boxok inaktiválásának határa a SZERVER órája szerint
// (LOG-11: a telefon órájával egy előresiető óra az összes, most felvitt boxot is inaktiválta,
// egy késő óra pedig semmit). A határ = a most felvitt sorok legkisebb updated_at-ja; a
// trigger / default a szerveren állítja, így minden idei sor >= határ.
export function batchStartFromRows(rows: { updated_at: string | null }[]): string | null {
  let min: string | null = null
  for (const r of rows) {
    if (!r.updated_at) continue
    if (min === null || r.updated_at < min) min = r.updated_at
  }
  return min
}

// ---- Az automatikus (napi) jegyzék-frissítés utolsó futásának összefoglalója a vezetőknek ----
export interface BoxSyncRun { ran_at: string; ok: boolean; listed: number | null; added: number | null; deactivated: number | null; note: string | null }
export interface BoxSyncStatus { tone: 'ok' | 'warn' | 'error'; text: string }

// tone: ok = friss és sikeres; warn = régóta nem futott (vagy még soha); error = az utolsó próbálkozás elbukott
export function boxSyncStatus(run: BoxSyncRun | null | undefined, when: (iso: string) => string, now = Date.now()): BoxSyncStatus {
  if (!run) return { tone: 'warn', text: 'Automatikus frissítés még nem futott.' }
  const at = when(run.ran_at)
  if (!run.ok) return { tone: 'error', text: `Az utolsó automatikus frissítés (${at}) nem sikerült: ${run.note ?? 'ismeretlen hiba'}` }
  const parts = [`${run.listed ?? 0} box`]
  if (run.added) parts.push(`${run.added} új`)
  if (run.deactivated) parts.push(`${run.deactivated} megszűnt`)
  if (!run.added && !run.deactivated) parts.push('nincs változás')
  const base = `Utolsó automatikus frissítés: ${at} — ${parts.join(', ')}.${run.note ? ` ${run.note}` : ''}`
  const ageH = (now - new Date(run.ran_at).getTime()) / 3_600_000
  if (ageH > 48) return { tone: 'warn', text: `${base} Több mint ${Math.floor(ageH / 24)} napja nem futott — a napi frissítés azon a gépen megy, ahol a Claude app nyitva van.` }
  return { tone: 'ok', text: base }
}
