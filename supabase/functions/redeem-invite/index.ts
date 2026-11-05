// Meghívó beváltása: a token (uuid) birtoklása a jogosultság.
// action=info: meghívó adatai (érvényesség-ellenőrzéssel)
// action=redeem: ELSŐ LÉPÉSKENT lefoglaljuk a meghívót (used_at, csak ha még szabad és érvényes) — két
//   párhuzamos beváltásból csak egy mehet; hiba esetén a foglalás visszakerül. A HELYŐRZŐ fiók kap
//   emailt + jelszót (ugyanaz az id → a beosztások megmaradnak), a profil aktív lesz.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let payload: { action?: string; token?: string; password?: string; email?: string }
  try { payload = await req.json() } catch { return json({ error: 'Érvénytelen kérés' }, 400) }
  const token = (payload.token ?? '').trim()
  if (!UUID_RE.test(token)) return json({ error: 'Érvénytelen meghívó' }, 400)

  const { data: inv, error: invErr } = await admin.from('invites')
    .select('id, workspace_id, email, full_name, role, created_by, expires_at, used_at, placeholder_id').eq('id', token).maybeSingle()
  if (invErr) { console.error('invite select', invErr); return json({ error: 'A meghívó ellenőrzése nem sikerült' }, 500) }
  if (!inv) return json({ error: 'A meghívó nem található' }, 404)
  if (inv.used_at) return json({ error: 'Ezt a meghívót már felhasználták' }, 410)
  if (new Date(inv.expires_at).getTime() < Date.now()) return json({ error: 'A meghívó lejárt — kérj újat' }, 410)

  const { data: ws } = await admin.from('workspaces').select('name').eq('id', inv.workspace_id).maybeSingle()

  if (payload.action === 'info') {
    return json({ email: inv.email, full_name: inv.full_name, workspace: ws?.name ?? '', role: inv.role })
  }

  if (payload.action === 'redeem') {
    const password = payload.password ?? ''
    if (password.length < 8) return json({ error: 'A jelszó legalább 8 karakter legyen' }, 400)
    const email = (inv.email ?? payload.email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return json({ error: 'Adj meg egy érvényes email-címet' }, 400)

    // 1) foglalás: csak ha még szabad és érvényes (párhuzamos beváltás ellen)
    const { data: claimed, error: claimErr } = await admin.from('invites')
      .update({ used_at: new Date().toISOString(), email })
      .eq('id', inv.id).is('used_at', null).gt('expires_at', new Date().toISOString())
      .select('id')
    if (claimErr) { console.error('invite claim', claimErr); return json({ error: 'A meghívó lefoglalása nem sikerült' }, 500) }
    if (!claimed || claimed.length === 0) return json({ error: 'Ezt a meghívót már felhasználták' }, 410)
    const release = async () => { await admin.from('invites').update({ used_at: null, email: inv.email }).eq('id', inv.id) }

    let userId: string
    let createdNow = false
    if (inv.placeholder_id) {
      const { data: upd, error: uErr } = await admin.auth.admin.updateUserById(inv.placeholder_id, {
        email, password, email_confirm: true, user_metadata: { full_name: inv.full_name ?? email, placeholder: false },
      })
      if (uErr || !upd?.user) {
        await release()
        const msg = uErr?.message ?? ''
        if (/already|registered|exists/i.test(msg)) return json({ error: 'Ezzel az email-címmel már van fiók — jelentkezz be a belépési oldalon' }, 409)
        console.error('placeholder update', msg)
        return json({ error: 'A fiók aktiválása nem sikerült' }, 500)
      }
      userId = inv.placeholder_id
    } else {
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: inv.full_name ?? email },
      })
      if (cErr || !created?.user) {
        await release()
        const msg = cErr?.message ?? ''
        if (/already|registered|exists/i.test(msg)) return json({ error: 'Ezzel az email-címmel már van fiók — jelentkezz be a belépési oldalon' }, 409)
        console.error('create user', msg)
        return json({ error: 'A fiók létrehozása nem sikerült' }, 500)
      }
      userId = created.user.id
      createdNow = true
    }

    const activate = () => admin.from('profiles').update({
      role: inv.role, workspace_id: inv.workspace_id, status: 'active', email,
      full_name: inv.full_name ?? email, approved_by: inv.created_by, approved_at: new Date().toISOString(),
    }).eq('id', userId).select('id')
    let { data: act, error: pErr } = await activate()
    // átmeneti hiba (vagy a profil-sor még nem jött létre): egy újrapróbálás
    if (pErr || !act || act.length === 0) {
      await new Promise((r) => setTimeout(r, 400))
      ;({ data: act, error: pErr } = await activate())
    }
    if (pErr || !act || act.length === 0) {
      // SEC-14: a beváltás ne ragadjon félkész állapotban — az imént létrehozott fiókot töröljük,
      // a meghívót visszaadjuk, így a link újra használható (a helyőrző fióknál az újrapróbálás
      // ugyanazt a fiókot frissíti, ott törölni nem kell)
      console.error('profile activate', pErr ?? 'no profile row')
      if (createdNow) {
        const { error: dErr } = await admin.auth.admin.deleteUser(userId)
        if (dErr) console.error('rollback delete user', dErr.message)
      }
      await release()
      return json({ error: 'A profil aktiválása nem sikerült — próbáld újra a meghívó linkjével' }, 500)
    }

    await admin.from('invites').update({ used_by: userId }).eq('id', inv.id)
    return json({ ok: true, email })
  }

  return json({ error: 'Ismeretlen művelet' }, 400)
})
