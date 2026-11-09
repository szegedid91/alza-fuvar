// AlzaBox-kijelző fotó kiolvasása Claude-dal: a Box-lap mezőinek előtöltéséhez.
// Bejelentkezett, AKTÍV felhasználó hívja (JWT-t mi ellenőrizzük). A képek csak a saját munkaterület
// box_sheet_stop_photos sorai lehetnek (nem tetszőleges storage-útvonal), szigorú minta-ellenőrzéssel.
// Modell: Claude Haiku 5.5. Kulcs: ANTHROPIC_API_KEY secret. Napi korlát felhasználónként.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const MODEL = Deno.env.get('BOX_PHOTO_MODEL') ?? 'claude-haiku-5-5'
const DAILY_LIMIT = 150 // kiolvasás / felhasználó / nap (kb. 40 box × 3-4 próba)
const MAX_IMAGES = 8 // ennyi (a legfrissebb) képet kap meg a modell egy kiolvasáshoz
const PATH_RE = /^[0-9a-f-]{36}\/boxsheet\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/
// SEC-25: a napi keret a BUDAPESTI nap szerint számol (a takarító cron is ezt nézi), nem UTC szerint
const budapestDay = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest' }).format(new Date())

const FIELDS = ['placed', 'missorted', 'nf', 'oversize', 'shortage', 'returned', 'invalid_code', 'do_not_place', 'cancelled', 'left_on_car'] as const
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    placed: { type: ['integer', 'null'] }, shortage: { type: ['integer', 'null'] }, nf: { type: ['integer', 'null'] }, oversize: { type: ['integer', 'null'] },
    missorted: { type: ['integer', 'null'] }, returned: { type: ['integer', 'null'] }, invalid_code: { type: ['integer', 'null'] }, do_not_place: { type: ['integer', 'null'] }, cancelled: { type: ['integer', 'null'] }, left_on_car: { type: ['integer', 'null'] },
    codes: { type: 'array', items: { type: 'string' } }, screen: { type: ['string', 'null'] }, confidence: { type: ['number', 'null'] }, note: { type: ['string', 'null'] },
    unmapped: { type: 'array', items: { type: 'string' } },
  },
  required: ['placed', 'shortage', 'nf', 'oversize', 'missorted', 'returned', 'invalid_code', 'do_not_place', 'cancelled', 'left_on_car', 'codes', 'screen', 'confidence', 'note', 'unmapped'],
}

// Csonka JSON-ból a már kiírt mezők kinyerése: "placed":35, "shortage":null, "codes":["1610608725", …
function salvage(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of FIELDS) {
    const m = text.match(new RegExp(`"${f}"\\s*:\\s*(-?\\d+)`))
    if (m) out[f] = parseInt(m[1], 10)
  }
  const codes = text.match(/"codes"\s*:\s*\[([^\]]*)/)
  if (codes) { const list = [...codes[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]); if (list.length) out.codes = list }
  const screen = text.match(/"screen"\s*:\s*"([^"]*)"/)
  if (screen) out.screen = screen[1]
  if (Object.keys(out).length) out.note = 'A kiolvasás félbeszakadt — ellenőrizd a számokat a képen.'
  return out
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Nincs bejelentkezve' }, 401)
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData.user) return json({ error: 'Érvénytelen bejelentkezés' }, 401)
  const uid = userData.user.id
  const { data: prof } = await admin.from('profiles').select('workspace_id, status, role').eq('id', uid).maybeSingle()
  if (!prof || prof.status !== 'active') return json({ error: 'Csak aktív felhasználó használhatja' }, 403)
  const ws = new Set<string>()
  if (prof.workspace_id) ws.add(prof.workspace_id)
  if (prof.role === 'manager' || prof.role === 'admin') {
    const { data: mws } = await admin.from('manager_workspaces').select('workspace_id').eq('manager_id', uid)
    for (const r of mws ?? []) ws.add(r.workspace_id)
  }
  if (ws.size === 0) return json({ error: 'Nincs munkaterület' }, 403)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'A képolvasás nincs beállítva (hiányzik az ANTHROPIC_API_KEY titok a Supabase Edge Functions beállításaiban).' }, 503)

  let payload: { paths?: unknown; box?: unknown; debug?: unknown }
  try { payload = await req.json() } catch { return json({ error: 'érvénytelen kérés' }, 400) }
  const rawPaths = Array.isArray(payload.paths) ? (payload.paths as unknown[]).filter((p): p is string => typeof p === 'string').slice(-MAX_IMAGES) : []
  if (rawPaths.length === 0) return json({ error: 'nincs kép' }, 400)
  // szigorú minta + saját munkaterület + létező box-fotó sor (nem tetszőleges fájl)
  if (rawPaths.some((p) => !PATH_RE.test(p) || p.includes('..') || !ws.has(p.split('/')[0]))) return json({ error: 'Nincs jogosultság a képekhez' }, 403)
  const { data: rows } = await admin.from('box_sheet_stop_photos').select('storage_path, workspace_id').in('storage_path', rawPaths)
  const paths = rawPaths.filter((p) => (rows ?? []).some((r: { storage_path: string; workspace_id: string }) => r.storage_path === p && ws.has(r.workspace_id)))
  if (paths.length === 0) return json({ error: 'Nincs jogosultság a képekhez' }, 403)

  // napi korlát (költségvédelem): számláló az internal_config-ban, kulcs: rbp:{felhasználó}:{budapesti nap}
  const dayKey = `rbp:${uid}:${budapestDay()}`
  const { data: cnt } = await admin.from('internal_config').select('value').eq('key', dayKey).maybeSingle()
  const used = parseInt(cnt?.value ?? '0', 10) || 0
  if (used >= DAILY_LIMIT) return json({ error: 'A mai kiolvasási keret elfogyott — írd be a számokat kézzel.' }, 429)
  await admin.from('internal_config').upsert({ key: dayKey, value: String(used + 1) }, { onConflict: 'key' })

  const images: { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }[] = []
  for (const p of paths) {
    const { data: blob, error } = await admin.storage.from('photos').download(p)
    if (error || !blob) continue
    const buf = new Uint8Array(await blob.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    images.push({ type: 'image', source: { type: 'base64', media_type: (blob.type && blob.type.startsWith('image/')) ? blob.type : 'image/jpeg', data: btoa(bin) } })
  }
  if (images.length === 0) return json({ error: 'A képeket nem sikerült beolvasni' }, 500)

  const system = `Egy AlzaBox csomagautomata kijelzőjéről és csomagcímkékről készült telefonos fotókat olvasol ki egy magyar futár napi Box-lapjához.
A kijelzőn tipikus feliratok: "Behelyezve: N" (behelyezett csomagok száma → placed), "Még ennyit kell behelyezni: N" (még be nem helyezett → shortage), csomagkód-listák (pl. 1608687656, ETIK/XL jelöléssel → codes), "Ezt a csomagot ne helyezd be" (NHB → do_not_place +1), "Érvénytelen kód" (ÉK → invalid_code +1), "Törölt" / "A csomag törölve" (→ cancelled +1), "Nincs szabad fiók" (NF → nf +1).
Minden mező egész szám; ha a képen nem látszik, null. A confidence 0 és 1 közötti szám. A screen a kijelző fő felirata röviden. A note rövid magyar megjegyzés, ha valami nem egyértelmű.
Az unmapped lista: a kijelzőn látható olyan hibaüzenet vagy felirat, amely egyik fenti mezőhöz sem tartozik egyértelműen (pl. "A fiók nem nyílik", "Kommunikációs hiba", "Nem olvasható vonalkód", karbantartás) — szó szerint, röviden, legfeljebb 8 tétel; ha nincs ilyen, üres lista.`
  const boxLabel = typeof payload.box === 'string' ? payload.box.slice(0, 80) : 'ismeretlen'
  const userText = `Box: ${boxLabel}. Olvasd ki a számokat a képekről. Ha egy számot több kép is mutat, a legfrissebb/legnagyobb "Behelyezve" értéket vedd.`

  const started = Date.now()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      // a modell a válasz előtt gondolkodik is: szűk kerettel a JSON félbevágva (vagy meg sem) érkezett
      model: MODEL, max_tokens: 4000, system,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [...images, { type: 'text', text: userText }] }],
    }),
  })
  const bodyText = await res.text()
  if (!res.ok) {
    console.error('anthropic error', res.status, bodyText.slice(0, 500))
    return json({ error: `AI hiba (${res.status})` }, 502)
  }
  let out: { content?: { type: string; text?: string }[]; usage?: unknown; stop_reason?: string }
  try { out = JSON.parse(bodyText) } catch { return json({ error: 'AI válasz nem olvasható' }, 502) }
  const text = (out.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const m = cleaned.match(/\{[\s\S]*\}/)
  let parsed: Record<string, unknown> = {}
  try { parsed = m ? JSON.parse(m[0]) : {} } catch { parsed = {} }
  if (Object.keys(parsed).length === 0) {
    // félbevágott válasz: ami szám már leíródott, azt megmentjük (a többi mező üres marad)
    parsed = salvage(cleaned)
    console.error('no json in response', out.stop_reason, Object.keys(parsed).length ? 'salvaged ' + Object.keys(parsed).join(',') : '', text.slice(0, 300))
  }
  const result: Record<string, unknown> = { codes: Array.isArray(parsed.codes) ? parsed.codes.map(String).slice(0, 60) : [], screen: parsed.screen ?? null, confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null, note: parsed.note ?? null, unmapped: Array.isArray(parsed.unmapped) ? parsed.unmapped.filter((x: unknown) => typeof x === 'string').map((x: string) => x.slice(0, 160)).slice(0, 8) : [] }
  for (const f of FIELDS) { const v = parsed[f]; result[f] = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null }
  console.log('read-box-photo ok', MODEL, Date.now() - started, 'ms', JSON.stringify(out.usage ?? {}))
  return json({ result, model: MODEL, usage: out.usage ?? null, ms: Date.now() - started, raw: payload.debug === true ? text.slice(0, 800) : undefined, stop_reason: out.stop_reason })
})
