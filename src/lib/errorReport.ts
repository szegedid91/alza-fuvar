// Kliens-oldali hibák jelentése a client_errors táblába — így a telefonokon
// történő összeomlásokról (fehér képernyő, kezeletlen Promise) az admin a
// Napló oldalon értesül, nem csak akkor, ha valaki szól.
// Best effort: soha nem dob, offline-ban csendben elmarad.
import { supabase } from './supabase'

declare const __BUILD_TIME__: string

const MAX_PER_SESSION = 10
let sent = 0
const seen = new Set<string>()

export async function reportClientError(message: string, stack?: string | null, extra?: { path?: string }): Promise<void> {
  try {
    if (sent >= MAX_PER_SESSION) return
    const key = message.slice(0, 200)
    if (seen.has(key)) return // ugyanaz a hiba többször egy munkamenetben → egyszer elég
    seen.add(key)
    const { data: u } = await supabase.auth.getUser()
    if (!u.user) return // bejelentkezés nélkül nincs hova (RLS: csak saját sor)
    sent++
    let workspaceId: string | null = null
    try { workspaceId = localStorage.getItem('alza-current-workspace') } catch { /* privát mód */ }
    await supabase.from('client_errors').insert({
      user_id: u.user.id,
      workspace_id: workspaceId,
      path: extra?.path ?? (typeof location !== 'undefined' ? location.pathname : null),
      message: message.slice(0, 2000),
      stack: stack ? stack.slice(0, 8000) : null,
      build: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : null,
    })
  } catch { /* a hibajelentés sosem okozhat újabb hibát */ }
}

// Globális kezelők: kezeletlen kivétel és Promise-elutasítás.
// A hálózati/megszakítási zajt kiszűrjük — azok nem programhibák.
const NOISE = /Failed to fetch|Load failed|NetworkError|AbortError|The operation was aborted|dynamically imported module/i

export function installGlobalErrorHandlers(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (e) => {
    const msg = e.message || String(e.error ?? 'Ismeretlen hiba')
    if (NOISE.test(msg)) return
    void reportClientError(msg, e.error instanceof Error ? e.error.stack : null)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    const msg = r instanceof Error ? r.message : typeof r === 'string' ? r : JSON.stringify(r ?? 'Ismeretlen hiba')
    if (NOISE.test(msg)) return
    void reportClientError(`Unhandled: ${msg}`, r instanceof Error ? r.stack : null)
  })
}
