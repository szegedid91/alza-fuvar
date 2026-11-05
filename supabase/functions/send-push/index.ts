// Web Push küldése a címzett felhasználók feliratkozásaira.
// Két hívási út:
//  1) kliens: aktív manager/admin JWT-vel — csak a SAJÁT munkaterületei tagjainak, korlátozott hosszal
//  2) DB-trigger (pg_net): az internal_config-ban tárolt közös titokkal (x-alza-secret)
// A verify_jwt kikapcsolva — a jogosultság-ellenőrzés itt, a kódban történik.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

// Időzítés-biztos titok-összehasonlítás (hash-ek bitenkénti összevetése)
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))])
  const x = new Uint8Array(ha), y = new Uint8Array(hb)
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

let vapidReady: Promise<boolean> | null = null
function ensureVapid(): Promise<boolean> {
  vapidReady ??= (async () => {
    let pub = Deno.env.get('VAPID_PUBLIC_KEY')
    let priv = Deno.env.get('VAPID_PRIVATE_KEY')
    let subj = Deno.env.get('VAPID_SUBJECT')
    if (!pub || !priv || !subj) {
      const { data } = await admin.from('internal_config').select('key, value').in('key', ['vapid_public_key', 'vapid_private_key', 'vapid_subject'])
      const cfg = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
      pub ||= cfg.vapid_public_key
      priv ||= cfg.vapid_private_key
      subj ||= cfg.vapid_subject
    }
    if (!pub || !priv) return false
    webpush.setVapidDetails(subj || 'mailto:admin@alza.hu', pub, priv)
    return true
  })()
  return vapidReady
}

// Csak app-on belüli útvonal: '/valami', de nem '//más-oldal' és nem backslash
function safeUrl(u: unknown): string {
  if (typeof u !== 'string' || !u.startsWith('/') || u.startsWith('//') || u.includes('\\')) return '/'
  try { return new URL(u, 'https://x.invalid').origin === 'https://x.invalid' ? u.slice(0, 200) : '/' } catch { return '/' }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // 1) belső hívás közös titokkal (DB-trigger / cron)
  let internal = false
  const secretHeader = req.headers.get('x-alza-secret') ?? ''
  if (secretHeader) {
    const { data: sec } = await admin.from('internal_config').select('value').eq('key', 'edge_shared_secret').maybeSingle()
    if (sec?.value && await safeEqual(secretHeader, sec.value)) internal = true
  }

  // 2) kliens hívás: csak aktív manager/admin, csak a saját munkaterületei tagjainak
  let callerWs: Set<string> | null = null // null = admin (minden)
  if (!internal) {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: userData } = await admin.auth.getUser(token)
    const uid = userData?.user?.id
    if (!uid) return json({ error: 'Bejelentkezés szükséges' }, 401)
    const { data: caller } = await admin.from('profiles').select('role, status, workspace_id').eq('id', uid).maybeSingle()
    if (!caller || caller.status !== 'active' || (caller.role !== 'manager' && caller.role !== 'admin')) {
      return json({ error: 'Csak menedzser vagy admin küldhet értesítést' }, 403)
    }
    if (caller.role !== 'admin') {
      callerWs = new Set<string>()
      if (caller.workspace_id) callerWs.add(caller.workspace_id)
      const { data: mws } = await admin.from('manager_workspaces').select('workspace_id').eq('manager_id', uid)
      for (const r of mws ?? []) callerWs.add(r.workspace_id)
    }
  }

  if (!(await ensureVapid())) return json({ error: 'Hiányzó VAPID kulcsok' }, 500)

  let payload: { user_ids?: unknown; title?: unknown; body?: unknown; url?: unknown; silent?: unknown; alarm?: unknown; tag?: unknown }
  try { payload = await req.json() } catch { return json({ error: 'érvénytelen kérés' }, 400) }
  let userIds = Array.isArray(payload.user_ids) ? (payload.user_ids as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 500) : []
  if (userIds.length === 0) return json({ sent: 0 })
  if (callerWs) {
    // csak a hívó munkaterületeinek tagjai maradnak címzettek
    const { data: members } = await admin.from('profiles').select('id, workspace_id').in('id', userIds)
    const allowed = new Set((members ?? []).filter((m: { id: string; workspace_id: string | null }) => m.workspace_id && callerWs!.has(m.workspace_id)).map((m: { id: string }) => m.id))
    userIds = userIds.filter((id) => allowed.has(id))
    if (userIds.length === 0) return json({ sent: 0 })
  }
  const title = (typeof payload.title === 'string' ? payload.title : 'Alza').slice(0, 100)
  const body = (typeof payload.body === 'string' ? payload.body : '').slice(0, 400)
  const url = safeUrl(payload.url)
  // Megjelenítési jelzők — a service worker (push-sw.js) értelmezi:
  //  silent: hang és rezgés nélkül; alarm: hosszabb rezgés, a képernyőn marad (csak belső hívásból);
  //  tag: az azonos címkéjű értesítés felülírja az előzőt
  const silent = payload.silent === true
  const alarm = internal && payload.alarm === true && !silent
  const tag = typeof payload.tag === 'string' && /^[\w-]{1,64}$/.test(payload.tag) ? payload.tag : null

  const { data: subs, error } = await admin.from('push_subscriptions').select('*').in('user_id', userIds)
  if (error) return json({ error: 'A feliratkozások lekérése nem sikerült' }, 500)

  const notif = JSON.stringify({ title, body, url, ...(silent ? { silent: true } : {}), ...(alarm ? { alarm: true } : {}), ...(tag ? { tag } : {}) })
  let sent = 0
  await Promise.all(
    (subs ?? []).map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, notif)
        sent++
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
      }
    }),
  )
  return json({ sent })
})
