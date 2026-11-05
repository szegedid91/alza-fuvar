# Alza Fuvarszervező — biztonsági és logikai audit (1. fázis, csak olvasás)

Dátum: 2026-11-04 · Commit: `0ec655f` · Supabase projekt: `jmhqsfeqfghzxsyqjgjd`

## 1. Architektúra-összefoglaló

**Kliens.** React 18 + Vite 5 + TypeScript PWA (`src/`), magyar UI, telefonra optimalizálva. Belépési pont `src/main.tsx` → `App.tsx` (szerep-alapú route-ok: crew / manager / admin; lusta oldalbetöltés `lazyRetry`-vel). Globális állapot: `AuthContext` (Supabase session + `profiles` sor, jelszó-visszaállítás mód), `WorkspaceContext` (elérhető munkaterületek, aktív workspace `localStorage`-ben), TanStack Query (30 s staleTime, teljes cache `localStorage`-be perzisztálva 24 h-ra, `buster: v5`). Service worker: vite-plugin-pwa *prompt* módban, `clientsClaim`, `version.json` figyelés 5 percenként; Web Push kezelő `public/push-sw.js`.

**Auth.** Supabase Auth (email+jelszó, önregisztráció → `pending` profil; meghívó-link `/meghivo/:uuid` → `redeem-invite` edge function helyőrző fiókkal; emailes jelszó-visszaállítás hash-tokennel, `recovery.ts` zárja az appot az új jelszóig). Szerepek: `crew | manager | admin`, státusz `pending | invited | active | disabled`. A napi sofőr/rakodó/betanuló szerep a `shifts` táblából jön.

**Adatréteg.** Minden írás/olvasás közvetlenül PostgREST-en (anon kulcs + user JWT) — **a jogosultság kizárólag a DB-ben dől el**: 38 tábla RLS-sel, segédfüggvények `is_admin() / is_manager_or_admin() / is_active() / can_access_workspace() / user_workspace_ids()` (SECURITY DEFINER, `search_path=public`), ~30 trigger (audit-napló, hónap-zár, becsekkolás-őr, profil-őr, push-értesítések `pg_net`-tel), 25 RPC (szerep/státusz/bér, törlés kaszkáddal, csere-döntés, járat-műveletek, `follow_shift_to_car`). Offline írás: `src/lib/outbox.ts` (IndexedDB sor, kliens-UUID = idempotencia-kulcs, upsert visszajátszás, `navigator.locks`). Fotók: privát `photos` bucket (8 MB, jpeg/png/webp), `{workspace}/{mappa}/{id}.jpg` + bélyegkép, SHA-256 bizonyíték `photo_proofs`-ban, aláírt URL-ek.

**Külső integrációk / háttérfolyamatok.** 8 aktív edge function (`send-push` Web Push VAPID-dal; `redeem-invite`, `manage-invite`; `ocr-fuel` → OCR.space; `read-box-photo` → Anthropic API napi limittel; `notify-pending`, `notify-inspection`, `photo-retention` — ezeket DB-trigger/cron hívja `x-alza-secret` közös titokkal, ami `internal_config`-ban van, kliens-hozzáférés nélkül). pg_cron: fotó-megőrzés naponta, ellenőrzés-emlékeztető és késés-riasztás 5 percenként, fotó-hiány riasztás percenként, 30 napos retention a `client_errors` / `help_sessions` táblákra. Realtime: `postgres_changes` (RLS-szűrt) a cache-érvénytelenítéshez, *broadcast* csatorna a „Segítséget kérek” képernyőtükrözéshez. Harmadik fél: HIBP k-anonimitás, Nominatim geokódolás, WhatsApp `wa.me` linkek, Google Maps / Waze.

**Konfiguráció / kirakás.** `.env.local` (nincs verziókövetve; dev gyors-belépés fiókok csak localhoston), `vite.config.ts` (`__BUILD_TIME__`, dev fiókok kiszedése `mode=production`-nél), `public/_headers` (Cloudflare: no-store a SW/index-re, biztonsági fejlécek, CSP *report-only*). Éles: Cloudflare Pages (`alza.szakify.hu` → `alza-fuvar.pages.dev`); a `.github/workflows/deploy.yml` ezzel párhuzamosan GitHub Pages-re is épít (lásd SEC-21).

## 2. Lefedettség

- Minden fájl a `src/` alatt (116 fájl) soronként átnézve: 3 független ellenőrző (oldalak 1–2, komponensek+hookok+lib), a magréteget (main/App/auth/workspace/outbox/photos/push/helpShare/sw/recovery/errorReport/vite config/headers/SW) én néztem; a találatokat én egyesítettem és a DB-vel ütköztettem.
- Szerver oldal élőből kiolvasva: összes RLS-policy, függvény-forrás, trigger, constraint, grant, cron-job, storage-policy, edge function forrás, Supabase security advisor.
- Nem tudtam megnézni: Supabase Auth beállítások (email-megerősítés, OTP-lejárat, rate limit) — csak az advisor jelzését látom; Cloudflare dashboard (HSTS).

## 3. Találatok

Formátum: **ID · súlyosság · hely** — hiba és konkrét szcenárió. *Javítás.* Bizonyosság.

### Critical
Nincs.

### High
Nincs. (A SEC-01 egyetlen iframe-attribútumra van a High-tól — lásd ott.)

### Medium — biztonság

**SEC-01 · Medium · `src/pages/LiveView.tsx:119-129`, `src/lib/helpShare.ts:60-69,103-105`** — A futár képernyőjének HTML-je (`help_sessions.snapshot_html`, `html_attrs`, `body_attrs`, illetve az élő `frame` broadcast payload, validálás nélkül) nyers string-összefűzéssel kerül `doc.write`-ba és `root.innerHTML`-be a vezető oldalán. A tisztítás csak a *küldő* oldalon van; bármely crew-JWT közvetlenül írhat tetszőleges HTML-t a saját `help_sessions` sorába. Ma a `sandbox="allow-same-origin"` (scripts nélkül) megakadályozza a JS-futást, de a frame **az app originjában** van: ha bárki `allow-scripts`-et ad hozzá (pl. interaktív tükörhöz), az teljes XSS a vezető ellen (`localStorage['alza-auth']` session-lopás). Már most is lehetséges: `<meta http-equiv="refresh">`, CSS `url()` beacon (IP-szivárgás), hamis „vezetői” utasítás megjelenítése. *Javítás:* a fogadó oldalon DOMPurify (on* attribútumok, `style` url, `meta`, `link` tiltva), `srcdoc` + `sandbox=""` (opaque origin), `html_attrs`/`body_attrs` helyett csak whitelistelt attribútumok (`data-theme`, `class`) másolása, a beírt dokumentumba `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https://*.supabase.co">`. Bizonyosság: certain (mechanizmus), likely (mai hatás).

**SEC-02 · Medium · `src/lib/helpShare.ts:107`, `src/pages/LiveView.tsx:102`; DB: `realtime.messages` táblán nincs policy** — A `help:{session_id}` broadcast csatorna nyilvános. Az anon kulcs + a session UUID (bármely munkaterület-tag látja a `help_sessions`-ben, és az URL-ben is szerepel) elég ahhoz, hogy bárki `frame`-et küldjön (hamis képernyőt mutasson a vezetőnek), `msg`/`pointer`-t toljon a futár telefonjára (300 karakter tetszőleges szöveg, rezgéssel), vagy `end`-del lelője a sessiont. *Javítás:* `supabase.channel(name, { config: { private: true, ... } })` + RLS a `realtime.messages`-en (workspace-tagság a topic alapján), bejövő payload alakjának ellenőrzése. Bizonyosság: certain (nincs policy), likely (insider-támadás).

**SEC-03 · Medium · `src/lib/push.ts:48-55`, `src/context/AuthContext.tsx:84-88`** — Közös depó-telefon: kijelentkezéskor előbb a DB-sor törlődik, csak utána a böngésző-feliratkozás; ha a törlés elhasal (offline/hiba), a böngésző-feliratkozás megmarad az előző felhasználó sorával. A következő belépő `subscribePush`-a ugyanarra az `endpoint`-ra upsertel → RLS (`ps_own`) elutasítja → ő nem tud feliratkozni, **az előző felhasználó értesítései (nevek, rendszám, „segítséget kér” + oldal) pedig továbbra is erre a készülékre érkeznek**. *Javítás:* kijelentkezéskor a `sub.unsubscribe()` mindig fusson le (a DB-törlés eredményétől függetlenül; a push-szolgáltató 410-je után a `send-push` úgyis kitakarítja a sort); feliratkozáskor ütközésnél `send-push` oldali takarítás vagy service-role RPC az idegen endpoint-sor törlésére. Bizonyosság: likely.

### Medium — logika

**LOG-01 · Medium · `src/lib/labels.ts:107-111`, `src/pages/Fuel.tsx:86`** — `parseHuNumber` a három tizedesjegyű pontos számot ezres tagolásnak veszi: `"45.123"` → `45123`. Az OCR literszáma (`String(res.parsed.liters)`, pl. 45.123 l — a kutak 3 tizedest nyomtatnak) így 45 123 literként mentődik, a fogyasztás abszurd. Android billentyűzeten a kézi `.` is ezt adja. A `labels.test.ts:13` (`'1.234' → 1234`) rögzíti a kétértelműséget. *Javítás:* pont csak ≥2 ponttal elválasztott csoportnál ezres; az OCR-számokat `toLocaleString('hu-HU')`-val formázva töltsd a mezőbe. Bizonyosság: certain.

**LOG-02 · Medium · `src/lib/routePlan.ts:116-128`, `src/components/RouteCard.tsx:179-183`, `src/components/RouteProgressCard.tsx:66-67`** — A 04:00 előtti határidőt `deadlineMin` +1440-nel tolja, de `nowMin()`-t nem: 00:00–03:59 között `lateNow` nagy negatív → éjszakai járatnál a késés-ok sosem kötelező, a „késésben” jelzés sosem látszik. *Javítás:* ugyanazt a `<240 → +1440` szabályt a mostani időre is, vagy valódi időbélyegek összevetése. Bizonyosság: certain.

**LOG-03 · Medium · `src/hooks/useInspectionZone.ts:34-41`** — Az elhagyta-a-telephelyet emlékeztető elnyomása a *befejezetlen* ellenőrzést is ellenőrzésnek veszi (nincs `.not('completed_at','is',null)`, szemben `checkin.ts:70-73` és `photoHelp.ts:29`-cel). Elkezdett-félbehagyott `car_inspections` sor → sosem megy ki a zóna-elhagyás push, miközben a kapu zárva marad. *Javítás:* `completed_at` szűrő. Bizonyosság: likely.

**LOG-04 · Medium · `src/lib/fuel.ts:7-45`, `src/pages/Fuel.tsx:110-112`** — `previousFuelForCar` / `hasLaterOrEqualKm` / átlag nem nézi az `error`-t: hálózati/RLS hiba → `null`/`false` → a tankolás `consumption: null`, `km_warning: false`-szal mentődik, a visszafelé írt kilométer-állás nem bukik ki. *Javítás:* `if (error) throw error` (a hívó már try/catch-el). Bizonyosság: certain.

**LOG-05 · Medium · `src/components/RoutePlanImport.tsx:51-84,58`** — Járatterv-import járatonként `route_names` insert → globális `alza_boxes` insert/update → RPC, tranzakció nélkül. Félbeszakadás után az új járatok/boxok maradnak; újrafuttatva a `routes` *stale closure* miatt a már létrehozott kódok ismét insertelődnek (duplikált kód hiba). Két jármű azonos utolsó szóval (`routeCodeOf`) ugyanazt a kódot adja → duplikált insert. *Javítás:* egyetlen szerver-RPC az egész importra (vagy `route_names` újraolvasása a `mutationFn`-en belül + kód-dedup a parserben). Bizonyosság: likely.

**LOG-06 · Medium · `src/components/RouteCard.tsx:182-196`** — „Járat kész”: `go()` után azonnal `onRouteDone()` (WhatsApp + `done` státusz-esemény); ha a `route_runs` upsert elhasal (`onError` toast), a csoport mégis „Járat kész” üzenetet kap, a futás nem lép tovább. *Javítás:* WhatsApp a koppintásban nyílhat, de a `done` rögzítése a `setIndex.onSuccess`-ben. Bizonyosság: certain.

**LOG-07 · Medium · `src/pages/shift/WeekTable.tsx:205-229`** — Cella-mentés elveszett-frissítés: `setCell` a *cache-elt* `shiftAt()` sorból építi a teljes sort és mind a négy mezőt upserteli (`onConflict: car_id,work_date,round`); a `shifts` táblára nincs realtime-érvénytelenítés. Két menedzser / két fül: A beírja a sofőrt, B (régi cache) a rakodót → B `driver_id: null`-t küld, A beosztása csendben törlődik. *Javítás:* létező sornál `update({[field]: value}).eq('id', cur.id)`, upsert csak új sornál; `useRealtimeInvalidate(ws, ['shifts'], …)`. Bizonyosság: likely.

**LOG-08 · Medium · `src/pages/Dashboard.tsx:278-287`** — Mind a 7 áttekintő lekérdezés eldobja az `error`-t: RLS-elutasítás/timeout/kiesés esetén zöld „minden rendben” dashboard (0 brigád, nincs figyelmeztetés, „Ma még senki nem csekkolt be”) — pont akkor, amikor a vezetőnek látnia kéne a hibát. *Javítás:* `error` kibontása és `throw` (ahogy `History.tsx` csinálja) → `isError` látszik. Bizonyosság: certain.

**LOG-09 · Medium · `src/pages/CarIssues.tsx:47-52,107-114`** — Nyitott hibák listája `limit(40)` a legfrissebb sorokra, utána kliens-oldali szűrés: a 40 legújabbnál régebbi nyitott hiba eltűnik a „Nyitott” nézetből, `activeCount` alulszámol, miközben `Cars.tsx:240` és `Dashboard.tsx:285` az összeset számolja. Az `error` itt is el van nyelve („Nincs nyitott hiba”). *Javítás:* menedzsernek `neq('status','resolved')` korlát nélkül (+ megoldottak limittel), hibánál `throw`. Bizonyosság: certain.

**LOG-10 · Medium · `src/pages/Adjustments.tsx:37-44,141-144`** — „Ebben a hónapban felvett előleg” a teljes munkaterület utolsó 60 tételéből összegzi a kiválasztott tag sorait; >60 tétel a mozgó ablakban → a tag korábbi e havi előlegei kiesnek, a menedzser túl alacsony összeget lát az újabb előleg jóváhagyásakor. *Javítás:* külön, limit nélküli lekérdezés `.eq('user_id').gte('work_date', ym+'-01')`. Bizonyosság: certain.

**LOG-11 · Medium · `src/pages/Boxes.tsx:137,153-157`** — Box-import után tömeges inaktiválás a *kliens órája* alapján: `startedAt = new Date().toISOString()` → `update({active:false}).lt('updated_at', startedAt)`. Ha a telefon órája előresiet az import idejénél többel, **minden box** (a most felvittek is) inaktív lesz; ha késik, semmi sem. Részleges (≥100 soros) lista esetén a benne nem szereplő összes box inaktiválódik. *Javítás:* szerver-oldali `now()` (RPC) vagy `import_batch_id` oszlop és `deactivate where batch <> $batch`. Bizonyosság: possible (óra-eltolódástól függ; hatása nagy).

**LOG-12 · Medium · `src/pages/Inspection.tsx:62-89,143-166`** — Újrafotózás verseny: a fotó-ID nézetenként fix, feltöltés `upsert: true` ugyanarra az útvonalra, az újrafotózás nem várja/szakítja meg a folyamatban lévő feltöltést. Lassú hálózaton az első (homályos) kép később ér be, mint a második → a storage-ban a régi kép, a `photo_proofs` hash az újról → a bizonyíték a visszautasított kép, és „manipulált”-nak jelzi a Képek oldal. *Javítás:* új ID újrafotózáskor (vagy az új feltöltés láncolása az előző lezárása után), hash a ténylegesen tárolt blobról. Bizonyosság: possible.

### Low — biztonság

**SEC-04 · — · DB `profiles.prof_select`** — Minden manager látja az összes `pending` profilt munkaterülettől függetlenül. *Döntés (2026-11-04): szándékos, nem találat.*

**SEC-05 · Low · DB `guard_profile_update`** — A felhasználó a saját `profiles.email` mezőjét szabadon átírhatja (nem védett oszlop), így eltérhet az auth-emailtől; az emailt a `notify_pending_registration` meghívó-egyeztetése és a vezetői felület használja. *Javítás:* `email` felvétele az őrzött oszlopok közé (csak service role / `auth.users` szinkron). Bizonyosság: certain.

**SEC-06 · Low · DB `create_relief_route`** — Csak az *első* `stop_id` munkaterületét ellenőrzi; a további `stop_id`/`from_route_id` értékek bármely workspace `route_stops` sorait törlik/átmozgatják (SECURITY DEFINER, RLS-t megkerülve). Az UUID-k más workspace-ből RLS miatt nem olvashatók, ezért a gyakorlati kihasználás szivárgást feltételez. *Javítás:* minden stop `workspace_id = v_ws` ellenőrzése, idegen sornál exception. Bizonyosság: likely.

**SEC-07 · Low · DB `swap_requests.sw_insert`, `swap_request_rate_limit`** — Az insert nem ellenőrzi, hogy `requested_by` a `shift_id` sofőrje/rakodója, hogy `partner_id` a másik fél, sem hogy `shift.workspace_id = workspace_id`. Crew tetszőleges `partner_id`-nak küldhet „cserekérés” push-t, és a menedzser-jóváhagyás (`decide_swap`) egy olyan shift sofőr↔rakodó párját cseréli, amelyhez a kérő nem is tartozik (pl. betanulóként). *Javítás:* a BEFORE INSERT triggerben tagság- és workspace-ellenőrzés. Bizonyosság: certain. (A menedzser társ-döntés nélküli felülbírálása a kód szerint szándékos — nem találat.)

**SEC-08 · Low · DB `route_stop_logs.rsl_insert`** — Csak `user_id = auth.uid()`: bármely aktív tag bármely járat/autó/kör leadását naplózhatja (`delay_reason`-nel → push az összes vezetőnek), nem csak a beosztott brigád (a `route_runs.rr_insert` ezt helyesen ellenőrzi). *Javítás:* ugyanaz a shift-tagsági feltétel, mint `rr_insert`-ben. Bizonyosság: certain.

**SEC-09 · Low · DB `box_sheets.bsheet_update`; `src/pages/BoxSheet.tsx:135-141`** — Crew a saját lapján bármely oszlopot módosíthat (`work_date`, `car_id`, `status`, `submitted_at`); hónap-zár csak a `box_sheet_stops`-on van, a fejlécen nem. A UI az egyetlen korlát. *Javítás:* trigger, ami nem-menedzsernek tiltja `work_date/car_id/user_id/workspace_id` változtatását, és `enforce_month_lock` a `box_sheets`-re is. Bizonyosság: certain.

**SEC-10 · Low · DB grants (Supabase advisor)** — 9 SECURITY DEFINER függvény `anon`-nal is hívható RPC-ként (`set_user_role`, `create_relief_route`, `dissolve_relief_route`, `replace_route_stops`, és 5 trigger-függvény). Mind hibára fut (`auth.uid()` null), de trigger-függvénynek nem kéne az API-ból elérhetőnek lennie. *Javítás:* `revoke execute … from public, anon`; trigger-függvényeknél `authenticated`-től is. Bizonyosság: certain.

**SEC-11 · Low · Supabase Auth (advisor) + `src/pages/Login.tsx:63-65`, `ResetPassword.tsx`** — A kiszivárgott-jelszó védelem szerver-oldalon ki van kapcsolva; a kliens HIBP-ellenőrzése közvetlen `auth.signUp` / `updateUser` hívással megkerülhető. *Javítás:* bekapcsolás a dashboardon (Pro), vagy elfogadni a kockázatot. Bizonyosság: certain.

**SEC-12 · Low · DB `set_user_role`, `set_user_status`, `guard_profile_update`** — Manager egy *másik managert* (saját workspace-ben) crew-vá fokozhat le vagy letilthat (csak admin célpont védett); a `delete_member` viszont tiltja a manager törlését. Következetlen. *Javítás:* ha nem szándék, `v_target.role in ('manager','admin')` → csak admin. Bizonyosság: certain. *Döntés (2026-11-04): nem szándékos — javítandó: manager csak crew célpontot módosíthat.*

**SEC-13 · Low · DB `workspaces` (nincs CHECK), edge `photo-retention`, `src/pages/PhotoReview.tsx:90-102`** — A 7–3650 napos tartomány csak kliens-oldali; `photo_retention_days = 0` (API-ból) → a cutoff `now()` → a napi job **az összes fotót törli**. Írás csak adminnak engedett (RLS rendben). *Javítás:* `check (photo_retention_days between 7 and 3650)` + a jobban alsó korlát. Bizonyosság: certain.

**SEC-14 · Low · edge `redeem-invite` (redeem ág)** — A meghívó lefoglalása + `createUser` után, ha a `profiles` update elhasal, a meghívó használtként marad, a user létrejön, de inaktív profillal, újrapróbálási út nélkül. *Javítás:* `release()` ennél a hibánál is, vagy a teljes beváltás egy RPC-ben. Bizonyosság: likely.

**SEC-15 · Low · `vite.config.ts:16`, `src/lib/devAuth.ts:59`** — A dev gyors-belépés fiókok (valódi jelszavak a `.env.local`-ból) csak `mode === 'production'`-nél kerülnek ki a bundle-ből; `vite build --mode staging` vagy a `preview` build a jelszavakat a JS-be fordítja (a localhost-ellenőrzés csak futásidejű). *Javítás:* kiszedés, hacsak nem `mode === 'development'`. Bizonyosság: certain.

**SEC-16 · Low · `src/main.tsx:68-72`** — A teljes query-cache `localStorage`-be kerül szűrés nélkül: `help-session` sorok akár 900 KB `snapshot_html`-lel, 300 audit-sor teljes old/new JSON-nal (bér, telefon, email), tagprofilok, bér — 24 óráig, közös telefonon. Egy nagy pillanatkép túllépheti az ~5 MB kvótát, és a perzisztáló a *teljes* offline cache-t eldobja. *Javítás:* `dehydrateOptions.shouldDehydrateQuery` — `help-session`, `audit`, `client-errors`, bér kulcsok kizárása. Bizonyosság: certain.

**SEC-17 · Low · `src/lib/recovery.ts:11-20`, `src/pages/ResetPassword.tsx:17`** — A hash `error_description` paramétere (React-escape-elve, XSS nincs) megjelenik az app saját hibadobozában → adathalász link tetszőleges szöveget rakhat a hivatalos felületre. *Javítás:* csak kódból fix üzenet, az `error_description` sosem. Bizonyosság: certain.

**SEC-18 · Low · `src/components/Icon.tsx:116`, `src/lib/payslip.ts:22,43`** — Látens HTML-sinkek: `dangerouslySetInnerHTML` a `title` prop-pal (ma csak statikus string éri el, `ShiftEditor.tsx:179`), `ym` escape nélkül a `document.write`-ban, `esc` nem kezeli a `"`/`'`-t. *Javítás:* `<title>` React-gyerekként; `esc(ym)` és bővített `esc`. Bizonyosság: certain (sink), ma nincs kihasználás.

**SEC-19 · Low · `src/pages/Incident.tsx:131`, `src/pages/PhotoReview.tsx:264,300`** — `window.open(url,'_blank')` `noopener` nélkül (Supabase aláírt URL-ek). *Javítás:* `'noopener'`. Bizonyosság: certain.

**SEC-20 · Low · `src/pages/Boxes.tsx:141`, `src/components/BoxCard.tsx:60`** — Importált `photo_url` séma-ellenőrzés nélkül kerül `<img src>`-be (az `article_url` ellenőrzött): `data:`/követő URL lehetséges. *Javítás:* ugyanaz a `^https?://` szűrő. Bizonyosság: certain.

**SEC-21 · Low · `.github/workflows/deploy.yml`, Cloudflare** — Az éles a Cloudflare Pages, de minden push GitHub Pages-re is kirak egy nyilvános másolatot (`szegedid91.github.io/alza-fuvar` → jelenleg 301 a saját domainre; a `_headers` ott nem érvényes). Felesleges, karbantartandó második kirakási út. Az éles válaszokon nincs `Strict-Transport-Security`. *Javítás:* a workflow törlése vagy csak `workflow_dispatch`; HSTS bekapcsolása Cloudflare-ben. Bizonyosság: certain. *Döntés (2026-11-04): a workflow törölhető.*

**SEC-22 · Low · `package.json`** — `npm audit`: 20 találat, mind a build/teszt eszközláncban (vite 5.4.21: path traversal a dev-szerver optimized-deps `.map` kezelésében; vitest 2.1.9 + tinypool: csak nyitott Vitest UI/API szerverrel; postcss, browserslist, minimatch…). A futásidejű függőségek (react, supabase-js 2.110, react-router 7.18, leaflet, xlsx 0.20.3, idb, zxing, dnd-kit, tanstack) tiszták. *Javítás:* vite 7 + vitest 4 + vite-plugin-pwa 1.x frissítés, külön lépésben. Bizonyosság: certain.

**SEC-23 · Low · `src/components/ErrorBoundary.tsx:44`, `WeekTable.tsx:246,253`, `Evidence.tsx:53`, `Dashboard.tsx:177`, `Cars.tsx:299`, `Members.tsx:318`** — Nyers PostgREST/Postgres hibaüzenetek (tábla/trigger nevek) a felületen; a `translateAuthError` ismeretlen hibánál a Supabase-üzenetet mutatja. *Javítás:* generikus üzenet + konzol/`client_errors`. Bizonyosság: certain.

**SEC-24 · Low · `src/App.tsx:76`, `src/pages/Invite.tsx`** — Meghívó-token az URL path-ban (CDN/hosting logok, előzmények). Egyszer használatos, 7 napos — enyhíti. *Javítás:* hash-fragment token. Bizonyosság: certain.

**SEC-25 · Low · edge `read-box-photo`** — A napi limit kulcsai (`rbp:{uid}:{nap}`) az `internal_config`-ban örökre gyűlnek; a nap UTC szerint számolódik. *Javítás:* cron-takarítás, Budapest-nap. Bizonyosság: certain.

### Low — logika

**LOG-13 · Low · `src/lib/outbox.ts:244-298` vs `:174-205`** — Üres sornál `submitNow` a zár nélkül futtatja a rekordot; egy közben induló flush (online esemény, `useOutbox` intervallum, `AppShell:81`) ugyanazt a rekordot is futtatja. Insert/upsert idempotens, az update-ek azonos értékkel átmennek a triggeren — de ha a második futás nem-hálózati hibát kap, `doFlush` *visszaírja* a már törölt rekordot (parkolt „hibás” tétel egy sikeres mentésről), vagy a hívó kap hibát sikeres mentés után. *Javítás:* a közvetlen út is a `navigator.locks` alatt; `doFlush` catch-ében `put` előtt ellenőrizni, hogy a rekord még létezik. Bizonyosság: possible.

**LOG-14 · Low · `src/lib/outbox.ts:118-121`** — `op:'update'` üres `match`-csel az összes, a felhasználó által módosítható sort frissítené (RLS-en belül: az összes saját becsekkolást). Ma minden hívó ad `match`-et; látens. *Javítás:* `throw` ha `match` üres. Bizonyosság: certain.

**LOG-15 · Low · `src/pages/Scan.tsx:210-231` + DB `guard_check_in_edit`** — Offline becsekkolásnál nincs `checked_in_at` a rekordban, a trigger a `now()`-tól >5 percre eső értéket is felülírja: a 06:00-kor sorba állt és 09:00-kor felszinkronizált becsekkolás 09:00. Az utána sorba állt kijelentkezés (08:00) sérti a `checked_out_at < checked_in_at` szabályt → 5 próbálkozás után parkol, a nap sosem zárul, az óraszám hibás. *Javítás:* kliens `checked_in_at` küldése + a trigger korlátos ablakban (pl. `offline_captured_at`) elfogadja. Bizonyosság: likely.

**LOG-16 · Low · DB `guard_check_in_edit`; `src/pages/Scan.tsx:272-287`** — „Nap újranyitása” (checked_out_at → null) a triggerben `checked_in_at := now()` → az eredeti kezdés elvész, a Riportok/Statisztika (első be – utolsó ki) alulszámolja a napot; a kliens nem figyelmeztet. *Javítás:* eredeti `checked_in_at` megtartása, `reopened_at` külön. Bizonyosság: certain.

**LOG-17 · Low · `src/pages/Scan.tsx:106-115`** — `openCi` a cache-elt `today`-ból: ha másik fül/eszköz már becsekkolt A autóra és a cache régi, B beolvasása A lezárása nélkül insertel → két nyitott sor, csere-ok nélkül. *Javítás:* `doCheckIn`-ben szerver-oldali „bármely nyitott mai becsekkolás” lekérdezés (a :188 lookup kiterjesztése). Bizonyosság: likely.

**LOG-18 · Low · `src/pages/Scan.tsx:98`, `src/lib/checkin.ts:61-66`** — Crew csak a saját `shifts` sorát látja: más brigád sorára beosztott betanuló nem látszik → kapacitás alulszámol → hamis „tele az autó” figyelmeztetés + push. *Javítás:* betanuló-jelenlét SECURITY DEFINER RPC-vel. Bizonyosság: possible.

**LOG-19 · Low · `src/pages/BoxSheet.tsx:74-87`** — Insert a `useQuery` `queryFn`-jében; a UNIQUE constraint véd a duplikációtól, de párhuzamos mount/második fül „Nem sikerült megnyitni a mai lapot”-ot mutat, és a `retry` újra insertel. *Javítás:* mutation / `get_or_create_box_sheet` RPC. Bizonyosság: certain.

**LOG-20 · Low · `src/pages/BoxSheet.tsx:142-158`** — Megálló hozzáadása: stop insert, majd `end_time` update két lépésben; a második hibája után a futár újra hozzáad → duplikált megálló. *Javítás:* egy RPC vagy trigger az `end_time`-ra. Bizonyosság: certain.

**LOG-21 · Low · `src/pages/BoxSheet.tsx:408-424`** — `NumField` blur-ra ment; sikertelen mentésnél a helyi `txt` a beírt számot mutatja (a szerveren a régi), `useEffect([value])` nem fut. *Javítás:* `onError`-ban `txt` visszaállítása `value`-ból. Bizonyosság: certain.

**LOG-22 · Low · `src/pages/Payroll.tsx:100-126`** — Ha nincs a hónap elejénél korábbi `workspace_rate_history` sor (a `2000-01-01` alapsor hiányzik), a régi hónap a *mai* napidíjjal számolódik. *Javítás:* figyelmeztetés + 0, vagy az alapsor kikényszerítése. Bizonyosság: likely.

**LOG-23 · Low · `src/pages/Payroll.tsx:394`** — `<input type=month>` üres értéke `p_valid_from: '-01'`-ként megy az RPC-be → nyers szerverhiba. *Javítás:* `/^\d{4}-\d{2}$/` validálás. Bizonyosság: certain.

**LOG-24 · Low · `src/pages/Adjustments.tsx:25,69,125`** — Nincs dátum-validálás: üres vagy jövőbeli `work_date` is mehet (jövő hónapba könyvelt előleg). *Javítás:* érvényes dátum ≤ ma (vagy hónap vége). Bizonyosság: certain.

**LOG-25 · Low · `src/components/ParkCarButton.tsx:38-44`** — Offline: `submitNow` sorba áll, a siker-toast és a `['today']` érvénytelenítés lefut, a gomb aktív marad → ismételt koppintás több `check_ins` update-et sorol; a második a triggeren („csak egyszer”) elhasal és 5 próbálkozás után parkolt hibaként jelenik meg. *Javítás:* optimista cache-frissítés / tiltás, amíg a becsekkoláshoz függő outbox-tétel van. Bizonyosság: likely.

**LOG-26 · Low · `src/hooks/useToday.ts:51-58`** — Beosztás-lekérdezés `.limit(1).maybeSingle()` `order` nélkül: kétkörös napon a „tervezett” autó/járat/kör véletlenszerű. *Javítás:* `.order('round')`. Bizonyosság: certain.

**LOG-27 · Low · `src/pages/shift/WeekTable.tsx:121`** — `hasRound2 = isBox(carId) && …`: ha az autó kategóriája elveszti a `box_sheet` jelzőt, a meglévő 2. körös sorok eltűnnek a táblából, de a számlálók, duplikáció-jelzés, bér és `publishWeek` továbbra is számolják; a menedzser nem tudja törölni őket. *Javítás:* 2. kör mutatása, ha `shifts.some(round===2)`. Bizonyosság: likely.

**LOG-28 · Low · `src/pages/shift/WeekTable.tsx:217-222`** — Üres cellában járat választása csendben eldobódik (a „törlés” ág fut). *Javítás:* `route_id` tartalomnak számít, vagy a select tiltása személy nélkül. Bizonyosság: certain.

**LOG-29 · Low · `src/pages/shift/WeekTable.tsx:240-257`** — „Előző hét másolása (felülír)” valójában merge: a csak az aktuális héten lévő sorok megmaradnak; `ROUTE_TAKEN` trigger-hiba bármelyik soron az egész köteget elbuktatja nyers Postgres-üzenettel. *Javítás:* RPC-ben előbb törlés, vagy legalább a ROUTE_TAKEN fordítás újrahasznosítása. Bizonyosság: certain.

**LOG-30 · Low · `src/pages/Dashboard.tsx:345-351`** — `.limit(2000)` a PostgREST 1000-es plafonján csendben csonkul; `work_date desc` sorrendben az autók, amelyek utolsó munkanapja régebbi, kiesnek → `prevCrew` undefined → „Hiányzó kötelező ellenőrzés” sosem jelzi. *Javítás:* autónkénti utolsó nap (`distinct on` RPC/view) vagy `fetchAll`. Bizonyosság: likely.

**LOG-31 · Low · `src/pages/History.tsx:67-91`** — `fetchAll` nem egyedi rendezőkulccsal (`checked_in_at`, `created_at`): az 1000-es lapozás határán egyező értékek duplikálhatnak/kihagyhatnak sorokat. *Javítás:* `.order('id')` másodlagos kulcs. Bizonyosság: possible.

**LOG-32 · Low · `src/pages/CarIssues.tsx:59-67`** — Státusz-átmenet nincs őrizve: régi fülről „Megoldva” egy már megoldott hibán felülírja `resolved_by/resolved_at`-ot. *Javítás:* `.eq('status', expectedFrom)`, 0 sor = ütközés. Bizonyosság: certain.

**LOG-33 · Low · `src/pages/shift/SwapApprovals.tsx:72-73`** — Nincs busy/disabled állapot: dupla koppintás kétszer hívja `decide_swap`-ot, a második hibája („nincs függő kérés”) sikeres jóváhagyás után jelenik meg. *Javítás:* `busyId`, gombok tiltása. Bizonyosság: likely.

**LOG-34 · Low · `src/pages/Cars.tsx:80-94,267-274`** — Kategória-átrendezés N párhuzamos update cache-elt sorrendből, tranzakció nélkül (részleges hiba → duplikált `sort_order`); `toggleActive` `!car.active`-ot küld régi cache-ből (másik fül visszaaktiválhat). *Javítás:* `reorder_car_categories(uuid[])` RPC; `toggleActive` célértékkel + `.eq('active', car.active)`. Bizonyosság: certain.

**LOG-35 · Low · `src/pages/AuditLog.tsx:302-337`** — `audit_log`, `cars`, `route_names`, `car_categories` workspace-szűrő nélkül és workspace nélküli query-kulccsal: több-workspace-es admin vegyes naplót lát, workspace-váltás nem frissít. *Javítás:* `currentWorkspaceId` szűrő + kulcsban. Bizonyosság: certain.

**LOG-36 · Low · `src/components/RouteStopsEditor.tsx:36,54-83`** — `move`/`reorder` N nem-tranzakciós update (részleges hiba → duplikált `sort_order`); `add` a régi `stops` closure-ból számol sorszámot (párhuzamos hozzáadás ütközik). *Javítás:* egy RPC. Bizonyosság: certain.

**LOG-37 · Low · `src/components/StatusCard.tsx:130-141`** — Jelzés-gombokon nincs debounce/idempotencia: dupla koppintás két `status_events` sort rögzít (az Áttekintést zajosítja). *Javítás:* busy állapot a rögzítés alatt. Bizonyosság: certain.

**LOG-38 · Low · `src/lib/statusEvents.ts:26`** — `work_date: todayISO()` a legfeljebb 4 s GPS-várakozás *után* értékelődik, `at` a koppintás ideje → éjfél körül eltérhet. *Javítás:* mindkettő a koppintáskor. Bizonyosság: certain (szélső eset).

**LOG-39 · Low · `src/components/RouteCard.tsx:116-121`** — Egy futáson két munkatárs: régi `idx`-szel `go(idx+1)` visszalépteti a társ újabb indexét (a realtime enyhíti). *Javítás:* szerver-oldali `greatest(current_index, $new)` vagy stop-id alapú léptetés. Bizonyosság: possible.

**LOG-40 · Low · `src/components/MultiShotCamera.tsx:54`** — A `[shots]` függőségű cleanup minden új felvételnél az összes object URL-t visszavonja; a bélyegképek csak azért látszanak, mert az `<img>` már dekódolt; újra-mountnál törött képek. *Javítás:* visszavonás unmountkor ref-ből, vagy csak a törölt felvételnél. Bizonyosság: likely.

**LOG-41 · Low · `src/lib/checkin.ts:45-48,65`** — `getCrewForDay`/`traineeScheduled` elnyeli a hibát → üres brigád / nincs betanuló → kapacitás és mai állapot csendben rossz. *Javítás:* `throw`. Bizonyosság: certain.

**LOG-42 · Low · `src/lib/relief.ts:75-106`** — `planRelief` minden jelöltre minden iterációban teljes 2-opt rendezést futtat (O(n³) haversine, ≤60 iteráció): ~10 járat × 40 megálló másodpercekre fagyaszthatja a telefon UI-t. *Javítás:* rendezés egyszer jelöltenként / Web Worker. Bizonyosság: possible.

**LOG-43 · Low · `src/pages/Routes.tsx:35`** — `sort_order = routes.length + 1` törlés után duplikátumokat ad (csak sorrend). *Javítás:* `max(sort_order)+1`. Bizonyosság: certain.

**LOG-44 · Low · `src/pages/Invite.tsx:60-66`** — `isPasswordPwned` (hálózat) a `setBusy(true)` *előtt* fut: két koppintás két `redeem` hívást indít, a második „már felhasználva” hibát mutat a sikeres belépés után. *Javítás:* busy először. Bizonyosság: certain.

**LOG-45 · Low · `src/pages/Login.tsx:129`, `src/pages/ResetPassword.tsx:103,112`** — UI „legalább 6” (`minLength={6}`), a kód 8-at követel. *Javítás:* 8-ra igazítás. Bizonyosság: certain.

**LOG-46 · Low · DB `tick_route_late_alerts`, `route_late_alerts`, cron `route-late-alerts-5min`** — Csak `round = 1` futásokra készül késés-riasztás. *Döntés (2026-11-04): ilyen riasztás egyik körben sem kell — a függvény, a tábla és a cron-job eltávolítandó; helyette „nem indult el a munkába” riasztás jön (külön feladat, lásd 6. pont).*

**LOG-47 · Low · `src/components/RoutePlanImport.tsx:43-44`** — Prefix-visszaesés: ha nincs pontos egyezés, egy kód, amely egy *másik* valódi box kódjának előtagja (AB12 vs AB123), a rossz boxhoz rendelődik. *Javítás:* csak pontos egyezés, különben kézi választás. Bizonyosság: possible.

## 4. Ahol nem találtam semmit (ellenőrzött)

- **Injekció:** nincs nyers SQL a kliensben; az RPC-k paraméterezettek; `search_path=public` minden definer-függvényen. Nincs `eval`/`new Function`.
- **Szerep-eszkaláció szerver-oldalon:** `guard_profile_update`, `set_user_role` (saját szerep tiltva, admin csak admintól), `approve_user`, `manage-invite` (admin meghívás csak admintól), `delete_member`, `set_user_pay` (csak admin), `workspaces`/`payroll_locks`/`workspace_rate_history` (csak admin) — a kliens-oldali elrejtések mögött mind DB/edge ellenőrzés áll. `internal_config` (titkok) kliensről nem olvasható. `audit_log` csak admin-olvasás, írás csak triggerből. `anon` szerepnek egyetlen táblán sincs grantja.
- **Storage:** privát bucket, útvonal-alapú workspace-ellenőrzés, felülírás csak tulajdonosnak/menedzsernek, MIME és 8 MB korlát. Aláírt URL-ek 1 órásak.
- **Edge functionök:** `verify_jwt=false` függvényeknél a JWT/titok ellenőrzés a kódban van és helyes (időzítés-biztos összehasonlítás); `send-push` kliens-útja csak manager/admin, csak saját workspace-tagoknak; `read-box-photo` szigorú útvonal-minta + sor-egyezés; `ocr-fuel` aktív user + méretkorlát; `safeUrl` a push-linkekre.
- **XSS az oldalakon:** minden felhasználói szöveg JSX text-node; Leaflet popupok `esc()`-elve; wa.me `encodeURIComponent`; nav/maps URL csak számokból; `tel:` szűrve; `article_url` séma-ellenőrzött. (Kivételek: SEC-01, SEC-18, SEC-20.)
- **Open redirect:** nincs. Push `notificationclick` csak saját origin path-ot nyit.
- **CSRF:** nem releváns (Bearer token, nincs cookie-auth). CORS: edge functionök `*`-gal, de JWT/titok kötelező.
- **Titkok a kódban / git-történetben:** nincs (`.env.local` sosem volt commitolva; csak anon kulcs és VAPID publikus kulcs).
- **Excel formula-injekció:** `json_to_sheet` string cellákat ír; xlsx 0.20.3 (CVE-2023-30533, CVE-2024-22363 javítva).
- **Dátum/időzóna:** `todayISO`, `calendar.ts`, `monthRange`, riport-tartományok helyi (Budapest) napot használnak; a DB `Europe/Budapest`-tel számol; DST-biztos. Hét hétfővel kezdődik mindenhol.
- **Pénz:** HUF egész, `formatHuf` kerekít; nincs lebegőpontos összegzési hiba. Hónap-zár trigger véd `check_ins/adjustments/fuel_logs/shifts/box_sheet_stops` táblákon.
- **Rate limit:** `client_errors` 60/óra, `help_sessions` 10/óra, cserekérés 30 perc, `read-box-photo` 150/nap; Supabase Auth saját limitje.
- **Offline sor:** kliens-UUID + upsert idempotens, több fül `navigator.locks`-szal, kijelentkezéskor ürítés — rendben (kivéve LOG-13/14/15/25).

## 5. Döntések (2026-11-04, felhasználói áttekintés)

1. SEC-04 — szándékos: minden manager lát minden függő regisztrációt. Kivéve a találatok közül.
2. SEC-12 — manager NEM módosíthatja másik manager szerepét/állapotát → javítandó.
3. SEC-21 — a GitHub Pages workflow törölhető.
4. LOG-46 — járat-késés riasztás egyik körben sem kell → a mechanizmus eltávolítandó.
5. A séma-/trigger-változást igénylő javításokat (SEC-05..09, SEC-12, SEC-13, LOG-15/16, LOG-46) a 2. fázisban külön jelzem végrehajtás előtt.

## 6. Új igény (nem audit-találat): „nem indult el a munkába” riasztás

Manager és admin személyenként be-/kikapcsolhatja, hangos vagy néma módban, és beállíthatja a határidőt (óra:perc), ameddig az aznapra beosztott munkatársnak meg kell nyomnia az „Elindultam a munkába” gombot; ha addig nem nyomja meg, a vezető riasztást kap.

## 7. A 2. fázis eredménye (2026-11-05)

**Javítva** — minden találat külön commitban (az azonosító a commit-üzenetben), a `tsc -b` és a teljes `vitest` minden commit után zöld:

- Kliens: SEC-01, 03, 15–21, 23, 24; LOG-01–14, 17, 19–35, 37, 38, 40, 41, 43–45.
- Adatbázis (`supabase/migrations/20261104_audit_fixes.sql`, élesítve): SEC-02, 05, 06, 07, 08, 09, 10, 12, 13, 25; LOG-15, 16, 18, 46. A hozzá tartozó kliens-rész: privát help-csatorna, betanuló-RPC, a becsekkolás valódi idejének küldése, a Tagok oldalon a vezetői sorok zárolása menedzsernek.
- Edge: SEC-14 (`redeem-invite`: sikertelen profil-aktiválásnál a friss fiók törlődik, a meghívó visszakerül), SEC-25 (`read-box-photo`: budapesti nap + napi takarító cron).

**A tervezethez képest módosítva élesítés előtt:**

- SEC-10: a `storage_workspace_ok` jogát NEM vontam vissza az `authenticated` szereptől (a fotótár policy-jai hívják — a visszavonás megállította volna a fotófeltöltést); a visszavonás mindenhol csak `public`/`anon`.
- SEC-07: a tagság-ellenőrzés NULL-biztos lett (egyfős beosztásnál a `NOT IN` átengedte volna az idegen kérőt).
- LOG-16: a nap újranyitása megtartja az eredeti kezdést, de autócsere utáni visszaülésnél (A→B→A) továbbra is új szakasz indul.

**Ellenőrzés:** az adatbázis-szabályok valódi szerepkörökkel (munkatárs, menedzser) visszagörgetett tranzakcióban; a privát csatorna két tesztfiókkal (saját kérés + vezető csatlakozhat és üzen, más munkatárs és be nem lépett kliens elutasítva, nyilvános figyelő semmit nem kap). Az oldal-szintű javításokhoz (LOG-08/09/17/19–35/37/40/44) nincs egységteszt — a projektben nincs komponens-teszt környezet; ezeket típus-ellenőrzés és kézi próba fedi.

**Szándékosan nem javítva:**

- SEC-04 — szándékos működés (döntés).
- SEC-11 — a kiszivárgott-jelszó védelem a Supabase Auth beállítása (Dashboard → Authentication → Password security); kódból nem állítható.
- SEC-22 — csak a build/teszt eszközlánc érintett (vite 5 → 7, vitest 2 → 4 főverzió-váltás); külön, saját teszteléssel érdemes.
- LOG-36 — a megálló-átrendezés atomivá tétele új RPC-t igényel; ritka, a következő mentés helyreállítja.
- LOG-39 — kétfős futásnál a visszaléptetés szerver-oldali `greatest()`-et igényelne; a realtime enyhíti.
- LOG-42 — a mentesítő-tervezés lassúsága teljesítmény-kérdés, nem hibás eredmény.
- LOG-47 — az előtag-egyezés a jelenlegi box-kódoknál nem ütközik; a szigorítás elrontaná a rövidített kódú importot.

**Megmaradó kockázatok:**

- A privát help-csatornát csak a frissített kliensek használják: amíg egy futár telefonján a régi verzió fut, az élő tükrözés nála nem indul el (a kérés és a pillanatkép igen).
- LOG-15: az API-n keresztül a becsekkolás ideje legfeljebb 12 órával visszadátumozható (a napi bért nem érinti, az óraszámot igen).
- A Realtime „public channels” beállítás bekapcsolva maradt (a táblaváltozás-figyelés használja); a help-csatorna ettől függetlenül privát.
