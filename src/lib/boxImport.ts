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

// ── Kézi (beillesztett) box-lista ──────────────────────────────────────────────────────────
export interface ManualImportRow { psid: number; name: string; address?: string | null; lat?: number | null; lng?: number | null; code?: string | null; photo?: string | null; article?: string | null; desc?: string | null }

// Egy beillesztett sorból CSAK azok a mezők, amik tényleg benne vannak: egy részletek nélküli lista (név + azonosító)
// nem nullázhatja ki a meglévő box kódját, címét, koordinátáját, leírását.
export function manualImportRow(r: ManualImportRow): Record<string, unknown> {
  const row: Record<string, unknown> = { parcel_shop_id: r.psid, name: r.name.trim(), active: true }
  if (typeof r.address === 'string' && r.address.trim()) row.address = r.address
  if (typeof r.lat === 'number' && typeof r.lng === 'number') { row.lat = r.lat; row.lng = r.lng }
  if (typeof r.code === 'string' && r.code.trim()) row.code = r.code
  if (typeof r.photo === 'string' && /^https?:\/\//i.test(r.photo)) row.photo_url = r.photo
  if (typeof r.article === 'string' && /^https?:\/\//i.test(r.article)) row.article_url = r.article
  if (typeof r.desc === 'string' && r.desc.trim()) row.description = r.desc
  return row
}

// Az azonos mezőkészletű sorok egy kötegbe: így minden köteg ugyanazokat az oszlopokat írja
// (vegyes kötegben a hiányzó mező NULL-ra írná a meglévő értéket)
export function groupByShape(rows: Record<string, unknown>[]): Record<string, unknown>[][] {
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const sig = Object.keys(row).sort().join(',')
    if (!groups.has(sig)) groups.set(sig, [])
    groups.get(sig)!.push(row)
  }
  return [...groups.values()]
}

// Csak TELJES listánál inaktiválunk: legalább 100 sor, és a jelenlegi (Alza-azonosítós) aktív boxok legalább 80%-a
export function isFullBoxList(importedCount: number, activeWithPsid: number): boolean {
  return importedCount >= 100 && importedCount >= Math.ceil(activeWithPsid * 0.8)
}
