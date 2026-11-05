// AlzaBox-jegyzék napi automatikus frissítése — a böngészőből begyűjtött lista fogadása.
// Átmeneti megoldás, amíg nincs hivatalos Alza API: az alza.hu csak böngészőből érhető el, ezért a
// listát egy ütemezett böngészős futás gyűjti be az alza.hu oldaláról, és ide adja át.
//
// Hitelesítés két lépcsőben, hogy a tartós kulcs ne kerüljön idegen weboldal kontextusába:
//   1) action=ticket — a gépen tárolt tartós kulccsal (x-box-sync-key) egy 30 percig érvényes,
//      egyszer használható jegyet ad
//   2) action=known / import / log — a jeggyel (x-box-sync-ticket); az import fel is használja a jegyet
// verify_jwt kikapcsolva: nem felhasználói hívás, a jogosultságot a kulcs / jegy adja.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-box-sync-key, x-box-sync-ticket',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
// időzítés-biztos összehasonlítás (azonos hosszú hex hash-ek)
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
async function cfg(key: string): Promise<string | null> {
  const { data } = await admin.from('internal_config').select('value').eq('key', key).maybeSingle()
  return data?.value ?? null
}

const TICKET_KEY = 'box_sync_ticket'
const TICKET_TTL_MS = 30 * 60_000

async function ticketValid(ticket: string): Promise<boolean> {
  if (!ticket) return false
  const raw = await cfg(TICKET_KEY)
  if (!raw) return false
  let t: { hash?: string; expires?: number }
  try { t = JSON.parse(raw) } catch { return false }
  if (!t.hash || !t.expires || Date.now() > t.expires) return false
  return safeEqualHex(await sha256Hex(ticket), t.hash)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  let payload: { action?: unknown; rows?: unknown; note?: unknown }
  try { payload = await req.json() } catch { return json({ error: 'érvénytelen kérés' }, 400) }
  const action = typeof payload.action === 'string' ? payload.action : ''

  // 1) jegy kérése a tartós kulccsal
  if (action === 'ticket') {
    const key = req.headers.get('x-box-sync-key') ?? ''
    const expected = await cfg('box_sync_key_sha256')
    if (!key || !expected || !safeEqualHex(await sha256Hex(key), expected)) return json({ error: 'Érvénytelen kulcs' }, 401)
    const ticket = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    const { error } = await admin.from('internal_config').upsert(
      { key: TICKET_KEY, value: JSON.stringify({ hash: await sha256Hex(ticket), expires: Date.now() + TICKET_TTL_MS }) }, { onConflict: 'key' })
    if (error) { console.error('ticket store', error); return json({ error: 'A jegy mentése nem sikerült' }, 500) }
    return json({ ticket, expires_in: TICKET_TTL_MS / 1000 })
  }

  // 2) minden más a jeggyel
  if (!(await ticketValid(req.headers.get('x-box-sync-ticket') ?? ''))) return json({ error: 'Érvénytelen vagy lejárt jegy' }, 401)

  if (action === 'known') {
    // mely boxok részletei vannak már meg (ezeket nem kell újra lekérni), és melyek a legrégebben ellenőrzöttek
    const { data, error } = await admin.from('alza_boxes').select('parcel_shop_id, details_checked_at')
      .not('parcel_shop_id', 'is', null).order('details_checked_at', { ascending: true, nullsFirst: true }).range(0, 9999)
    if (error) { console.error('known', error); return json({ error: 'A jegyzék lekérése nem sikerült' }, 500) }
    const rows = (data ?? []) as { parcel_shop_id: number; details_checked_at: string | null }[]
    const checked = rows.filter((r) => r.details_checked_at)
    return json({ complete: checked.map((r) => r.parcel_shop_id), stale: checked.slice(0, 25).map((r) => r.parcel_shop_id), total: rows.length })
  }

  if (action === 'import') {
    const rows = Array.isArray(payload.rows) ? payload.rows : null
    if (!rows || rows.length === 0 || rows.length > 5000) return json({ error: 'Hiányzó vagy túl hosszú lista' }, 400)
    const { data, error } = await admin.rpc('import_alza_boxes', { p_rows: rows, p_source: 'auto' })
    if (error) {
      console.error('import', error)
      await admin.from('box_sync_runs').insert({ source: 'auto', ok: false, listed: rows.length, note: `Felvitel sikertelen: ${error.message}`.slice(0, 300) })
      return json({ error: 'A felvitel nem sikerült: ' + error.message }, 500)
    }
    await admin.from('internal_config').delete().eq('key', TICKET_KEY) // a jegy egyszer használható
    return json({ ok: true, ...(data as Record<string, unknown>) })
  }

  if (action === 'log') {
    // sikertelen futás jelzése (pl. az alza.hu nem adta ki a listát) — a vezetők az appban látják
    const note = typeof payload.note === 'string' ? payload.note.slice(0, 300) : 'ismeretlen hiba'
    await admin.from('box_sync_runs').insert({ source: 'auto', ok: false, note })
    return json({ ok: true })
  }

  return json({ error: 'Ismeretlen művelet' }, 400)
})
