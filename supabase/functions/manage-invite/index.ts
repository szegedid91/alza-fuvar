// Meghívó + helyőrző fiók kezelése (menedzser/admin JWT-vel).
//  create: meghívó ÉS helyőrző auth-fiók (status 'invited') — azonnal beosztható; hiba esetén nem marad félkész állapot.
//  delete: meghívó törlése; ha a helyőrző még nem regisztrált, a fiókja is törlődik; beosztással force nélkül 409.
//  renew: a meghívó érvényességének meghosszabbítása (INVITE_DAYS nap mától) — a helyőrző és a beosztások maradnak.
//  send_email: a meghívó linkje emailben (Resend API; RESEND_API_KEY + INVITE_MAIL_FROM titkok) — lejárt meghívót
//    előbb megújít; ha az emailküldés nincs beállítva, 503 + not_configured (a kliens a leveleződdel küldi).
// A verify_jwt kikapcsolva: a jogosultság-ellenőrzés itt, a kódban történik. A DB-hibák részletei a naplóba, nem a kliensnek.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const INVITE_DAYS = 30 // a meghívó érvényessége (a tábla 7 napos alapértelmezése helyett)
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://utod.szakify.hu').replace(/\/+$/, '')
const expiry = () => new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString()
const randomPassword = () => {
  const a = new Uint8Array(24); crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Ugyanaz a szöveg, mint a kliens mailto-fallbackjában (src/lib/inviteMail.ts)
function mailText(i: { name: string | null; inviter: string | null; workspace: string | null; link: string; expiresAt: string | null }): string {
  const until = i.expiresAt ? new Date(i.expiresAt).toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Budapest' }) : null
  return [
    `Szia${i.name?.trim() ? ` ${i.name.trim()}` : ''}!`,
    '',
    `${i.inviter?.trim() || 'A vezetőd'} meghívott az Utód Fuvarszervező appba${i.workspace?.trim() ? ` (${i.workspace.trim()})` : ''}.`,
    'A regisztrációhoz nyisd meg ezt a linket a telefonodon:',
    i.link,
    '',
    'A linken a telefonszámodat és egy jelszót kell megadnod, utána már be is léphetsz.',
    until ? `A meghívó ${until}-ig érvényes.` : '',
    '',
    'Ha nem te vagy a címzett, hagyd figyelmen kívül ezt a levelet.',
  ].filter((l, idx, arr) => !(l === '' && arr[idx - 1] === '')).join('\n')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: userData } = await admin.auth.getUser(token)
  const uid = userData?.user?.id
  if (!uid) return json({ error: 'Bejelentkezés szükséges' }, 401)
  const { data: caller } = await admin.from('profiles').select('role, status, workspace_id, full_name, email').eq('id', uid).maybeSingle()
  if (!caller || caller.status !== 'active' || (caller.role !== 'manager' && caller.role !== 'admin')) {
    return json({ error: 'Csak menedzser vagy admin kezelhet meghívót' }, 403)
  }

  let p: { action?: string; workspace_id?: string; full_name?: string; email?: string | null; role?: string; invite_id?: string; force?: boolean }
  try { p = await req.json() } catch { return json({ error: 'Érvénytelen kérés' }, 400) }

  const wsIds = new Set<string>()
  if (caller.workspace_id) wsIds.add(caller.workspace_id)
  const { data: mws } = await admin.from('manager_workspaces').select('workspace_id').eq('manager_id', uid)
  for (const r of mws ?? []) wsIds.add(r.workspace_id)

  if (p.action === 'create') {
    const wsId = p.workspace_id ?? caller.workspace_id ?? ''
    if (!wsIds.has(wsId) && caller.role !== 'admin') return json({ error: 'Nincs jogosultság ehhez a munkaterülethez' }, 403)
    const name = (p.full_name ?? '').trim().slice(0, 120)
    if (!name) return json({ error: 'A név kötelező' }, 400)
    const email = (p.email ?? '').trim().toLowerCase() || null
    if (email && !EMAIL_RE.test(email)) return json({ error: 'Érvénytelen email-cím' }, 400)
    const role = p.role === 'manager' || p.role === 'admin' ? p.role : 'crew'
    if (role === 'admin' && caller.role !== 'admin') return json({ error: 'Admint csak admin hívhat meg' }, 403)

    const { data: inv, error: iErr } = await admin.from('invites')
      .insert({ workspace_id: wsId, email, full_name: name, role, created_by: uid, expires_at: expiry() }).select('id').single()
    if (iErr || !inv) { console.error('invite insert', iErr); return json({ error: 'A meghívó létrehozása nem sikerült' }, 500) }

    // Helyőrző fiók: a profil a trigger által eleve 'invited' státusszal jön létre (placeholder: true)
    const authEmail = email ?? `invite-${inv.id}@placeholder.alza.invalid`
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email: authEmail, password: randomPassword(), email_confirm: true, user_metadata: { full_name: name, placeholder: true },
    })
    if (cErr || !created?.user) {
      await admin.from('invites').delete().eq('id', inv.id)
      const msg = cErr?.message ?? ''
      if (/already|registered|exists/i.test(msg)) return json({ error: 'Ezzel az email-címmel már van fiók' }, 409)
      console.error('placeholder create', msg)
      return json({ error: 'A helyőrző fiók létrehozása nem sikerült' }, 500)
    }
    const { error: pErr } = await admin.from('profiles').update({ role, workspace_id: wsId, status: 'invited', full_name: name, email: email ?? null }).eq('id', created.user.id)
    if (pErr) {
      // ne maradjon félkész állapot: a fiók és a meghívó is törlődik
      console.error('placeholder profile', pErr)
      await admin.auth.admin.deleteUser(created.user.id)
      await admin.from('invites').delete().eq('id', inv.id)
      return json({ error: 'A helyőrző profil beállítása nem sikerült' }, 500)
    }
    await admin.from('invites').update({ placeholder_id: created.user.id }).eq('id', inv.id)
    return json({ ok: true, invite_id: inv.id, placeholder_id: created.user.id })
  }

  if (p.action === 'delete') {
    const { data: inv } = await admin.from('invites').select('id, workspace_id, placeholder_id, used_at, full_name').eq('id', p.invite_id ?? '').maybeSingle()
    if (!inv) return json({ error: 'A meghívó nem található' }, 404)
    if (!wsIds.has(inv.workspace_id) && caller.role !== 'admin') return json({ error: 'Nincs jogosultság' }, 403)
    let removedAccount = false
    if (inv.placeholder_id && !inv.used_at) {
      const { data: ph } = await admin.from('profiles').select('status').eq('id', inv.placeholder_id).maybeSingle()
      if (ph?.status === 'invited') {
        const pid = inv.placeholder_id
        const { data: shifts } = await admin.from('shifts').select('work_date').or(`driver_id.eq.${pid},loader_id.eq.${pid},trainee_id.eq.${pid}`).order('work_date')
        const n = shifts?.length ?? 0
        if (n > 0 && !p.force) {
          return json({
            error: `${inv.full_name ?? 'A munkatárs'} ${n} napon szerepel a beosztásban (${shifts![0].work_date} – ${shifts![n - 1].work_date}). Törléskor ezekből a napokból kikerül.`,
            needs_confirm: true, shifts: n, first: shifts![0].work_date, last: shifts![n - 1].work_date,
          }, 409)
        }
        await admin.from('profiles').delete().eq('id', pid)
        await admin.auth.admin.deleteUser(pid)
        removedAccount = true
      }
    }
    await admin.from('invites').delete().eq('id', inv.id)
    return json({ ok: true, removedAccount })
  }

  if (p.action === 'renew' || p.action === 'send_email') {
    const { data: inv } = await admin.from('invites').select('id, workspace_id, placeholder_id, used_at, full_name, email, expires_at').eq('id', p.invite_id ?? '').maybeSingle()
    if (!inv) return json({ error: 'A meghívó nem található' }, 404)
    if (!wsIds.has(inv.workspace_id) && caller.role !== 'admin') return json({ error: 'Nincs jogosultság' }, 403)
    if (inv.used_at) return json({ error: 'Ezt a meghívót már felhasználták — nincs mit megújítani vagy elküldeni' }, 409)

    // lejárt (vagy hamarosan lejáró) meghívó: új érvényesség, hogy a kiküldött link biztosan működjön
    let expiresAt = inv.expires_at
    const soon = new Date(inv.expires_at).getTime() < Date.now() + 2 * 86_400_000
    if (p.action === 'renew' || soon) {
      expiresAt = expiry()
      const { error } = await admin.from('invites').update({ expires_at: expiresAt }).eq('id', inv.id)
      if (error) { console.error('invite renew', error); return json({ error: 'A meghívó megújítása nem sikerült' }, 500) }
    }
    if (p.action === 'renew') return json({ ok: true, expires_at: expiresAt })

    const email = (p.email ?? inv.email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return json({ error: 'Adj meg egy érvényes email-címet' }, 400)
    if (email !== inv.email) {
      const { error } = await admin.from('invites').update({ email }).eq('id', inv.id)
      if (error) { console.error('invite email', error); return json({ error: 'Az email-cím mentése nem sikerült' }, 500) }
      if (inv.placeholder_id) await admin.from('profiles').update({ email }).eq('id', inv.placeholder_id).eq('status', 'invited')
    }

    const apiKey = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('INVITE_MAIL_FROM')
    const { data: ws } = await admin.from('workspaces').select('name').eq('id', inv.workspace_id).maybeSingle()
    const link = `${APP_URL}/meghivo#${inv.id}`
    const text = mailText({ name: inv.full_name, inviter: caller.full_name ?? caller.email ?? null, workspace: ws?.name ?? null, link, expiresAt })
    if (!apiKey || !from) {
      return json({ error: 'Az automatikus emailküldés nincs beállítva (RESEND_API_KEY és INVITE_MAIL_FROM titok a Supabase Edge Functions beállításaiban).', not_configured: true, email, expires_at: expiresAt, subject: 'Meghívó az Utód Fuvarszervező appba', text }, 503)
    }
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111">${
      text.split('\n').map((l) => (l === link ? `<p><a href="${escHtml(link)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700">Regisztráció megnyitása</a><br><span style="font-size:12px;color:#555">${escHtml(link)}</span></p>` : l ? `<p style="margin:0 0 6px">${escHtml(l)}</p>` : '<br>')).join('')
    }</div>`
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], subject: 'Meghívó az Utód Fuvarszervező appba', text, html }),
    })
    if (!res.ok) {
      console.error('resend error', res.status, (await res.text()).slice(0, 500))
      return json({ error: `Az email küldése nem sikerült (${res.status}) — próbáld újra, vagy küldd el a leveleződből.` }, 502)
    }
    const sentAt = new Date().toISOString()
    await admin.from('invites').update({ email_sent_at: sentAt }).eq('id', inv.id)
    return json({ ok: true, sent_to: email, email_sent_at: sentAt, expires_at: expiresAt })
  }

  return json({ error: 'Ismeretlen művelet' }, 400)
})
