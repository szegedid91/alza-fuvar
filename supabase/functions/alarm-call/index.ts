// Telefonhívás a vezetőnek a „nem indult el a munkába” riasztáshoz (Twilio).
// Három hívási út:
//  1) belső (x-alza-secret, az adatbázis időzítője): { action: 'alarm', alarm_id } — a még meg nem nyitott
//     riasztás gazdáját hívja, felolvassa a hiányzókat; az 1-es gomb leállítja a riasztást
//  2) vezető a saját JWT-jével: { action: 'status' } (be van-e kötve, van-e hívható száma) és
//     { action: 'test' } (próbahívás a SAJÁT számára; 2 percenként egy, naponta legfeljebb 5)
//  3) a szolgáltató visszahívása a gombnyomásról: ?a=<riasztás>&k=<egyszeri kulcs> (űrlap: Digits)
// Csak magyar mobilszám hívható. A szolgáltatói kulcsok az edge function titkai:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (a hívó szám, pl. +1…)
// verify_jwt kikapcsolva — a jogosultságot itt, a kódban ellenőrizzük.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { huMobileE164, maskPhone, alarmTwiml, testTwiml, ackTwiml } from './helpers.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const xml = (body: string) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } })
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? ''
const TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? ''
const FROM = Deno.env.get('TWILIO_FROM') ?? ''
const configured = () => !!SID && !!TOKEN && !!FROM
const SELF = `${Deno.env.get('SUPABASE_URL')}/functions/v1/alarm-call`

async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))])
  const x = new Uint8Array(ha), y = new Uint8Array(hb)
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

// Hívás indítása; a naplóba mindig kerül sor (sikeres vagy sikertelen)
async function placeCall(p: { userId: string; alarmId: string | null; kind: 'alarm' | 'test'; to: string; twiml: string }): Promise<{ ok: boolean; error?: string }> {
  let status = 'failed', sid: string | null = null, error: string | null = null
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${SID}:${TOKEN}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: p.to, From: FROM, Twiml: p.twiml, Timeout: '40' }),
    })
    const body = await res.json().catch(() => ({})) as { sid?: string; status?: string; message?: string; code?: number }
    if (res.ok && body.sid) { status = body.status ?? 'queued'; sid = body.sid }
    else error = `${res.status}${body.code ? ` / ${body.code}` : ''}: ${body.message ?? 'ismeretlen hiba'}`.slice(0, 300)
  } catch (e) { error = String((e as Error).message ?? e).slice(0, 300) }
  if (error) console.error('twilio call', p.kind, error)
  await admin.from('alarm_calls').insert({ user_id: p.userId, alarm_id: p.alarmId, kind: p.kind, to_masked: maskPhone(p.to), status, sid, error })
  return error ? { ok: false, error } : { ok: true }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const url = new URL(req.url)

  // 3) a szolgáltató visszahívása: az 1-es gomb leállítja a riasztást
  const cbAlarm = url.searchParams.get('a'), cbKey = url.searchParams.get('k')
  if (cbAlarm && cbKey) {
    let digits = ''
    try { digits = String((await req.formData()).get('Digits') ?? '') } catch { /* nem űrlap */ }
    const { data: al } = await admin.from('setoff_alarms').select('id, call_token').eq('id', cbAlarm).maybeSingle()
    if (!al?.call_token || !(await safeEqual(cbKey, al.call_token))) return xml(ackTwiml(false))
    if (digits !== '1') return xml(ackTwiml(false))
    await admin.from('setoff_alarms').update({ seen_at: new Date().toISOString() }).eq('id', al.id).is('seen_at', null)
    return xml(ackTwiml(true))
  }

  let payload: { action?: unknown; alarm_id?: unknown }
  try { payload = await req.json() } catch { return json({ error: 'érvénytelen kérés' }, 400) }
  const action = typeof payload.action === 'string' ? payload.action : ''

  // 1) belső hívás az időzítőtől
  const secretHeader = req.headers.get('x-alza-secret') ?? ''
  if (secretHeader) {
    const { data: sec } = await admin.from('internal_config').select('value').eq('key', 'edge_shared_secret').maybeSingle()
    if (!sec?.value || !(await safeEqual(secretHeader, sec.value))) return json({ error: 'Érvénytelen titok' }, 401)
    if (action !== 'alarm' || typeof payload.alarm_id !== 'string') return json({ error: 'Ismeretlen művelet' }, 400)
    const { data: al } = await admin.from('setoff_alarms').select('id, user_id, missing, call_token, seen_at, dismissed_at, ended_reason').eq('id', payload.alarm_id).maybeSingle()
    if (!al || al.seen_at || al.dismissed_at || al.ended_reason || !al.call_token) return json({ skipped: 'a riasztás már nem él' })
    const { data: prof } = await admin.from('profiles').select('phone, status, role').eq('id', al.user_id).maybeSingle()
    const to = huMobileE164(prof?.phone)
    if (!prof || prof.status !== 'active' || !to) {
      await admin.from('alarm_calls').insert({ user_id: al.user_id, alarm_id: al.id, kind: 'alarm', status: 'skipped', error: 'nincs hívható magyar mobilszám a profilban' })
      return json({ skipped: 'nincs hívható szám' })
    }
    if (!configured()) {
      await admin.from('alarm_calls').insert({ user_id: al.user_id, alarm_id: al.id, kind: 'alarm', to_masked: maskPhone(to), status: 'skipped', error: 'a telefonos szolgáltató nincs beállítva' })
      return json({ skipped: 'nincs beállítva' })
    }
    const names = Array.isArray(al.missing) ? (al.missing as { name?: unknown }[]).map((m) => (typeof m?.name === 'string' ? m.name : '')).filter(Boolean) : []
    const action_url = `${SELF}?a=${encodeURIComponent(al.id)}&k=${encodeURIComponent(al.call_token)}`
    return json(await placeCall({ userId: al.user_id, alarmId: al.id, kind: 'alarm', to, twiml: alarmTwiml(names, action_url) }))
  }

  // 2) vezető a saját JWT-jével
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: userData } = await admin.auth.getUser(token)
  const uid = userData?.user?.id
  if (!uid) return json({ error: 'Bejelentkezés szükséges' }, 401)
  const { data: me } = await admin.from('profiles').select('role, status, phone').eq('id', uid).maybeSingle()
  if (!me || me.status !== 'active' || (me.role !== 'manager' && me.role !== 'admin')) return json({ error: 'Csak menedzser vagy admin használhatja' }, 403)
  const to = huMobileE164(me.phone)

  if (action === 'status') return json({ configured: configured(), phone: to ? maskPhone(to) : null })

  if (action === 'test') {
    if (!configured()) return json({ error: 'A telefonhívás még nincs bekötve (hiányoznak a szolgáltatói kulcsok).' }, 503)
    if (!to) return json({ error: 'A profilodban nincs hívható magyar mobilszám — a Tagok oldalon add meg (+36…).' }, 400)
    const since = new Date(Date.now() - 24 * 3600_000).toISOString()
    const { data: recent } = await admin.from('alarm_calls').select('created_at').eq('user_id', uid).eq('kind', 'test').gte('created_at', since).order('created_at', { ascending: false })
    if ((recent ?? []).length >= 5) return json({ error: 'Naponta legfeljebb 5 próbahívás indítható.' }, 429)
    if (recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < 120_000) return json({ error: 'Próbahívás 2 percenként indítható — várj egy kicsit.' }, 429)
    const r = await placeCall({ userId: uid, alarmId: null, kind: 'test', to, twiml: testTwiml() })
    return r.ok ? json({ ok: true, phone: maskPhone(to) }) : json({ error: 'A hívás nem indult el: ' + r.error }, 502)
  }

  return json({ error: 'Ismeretlen művelet' }, 400)
})
