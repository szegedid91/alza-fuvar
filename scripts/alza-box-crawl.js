// AlzaBox-jegyzék begyűjtése az alza.hu „Boltok és Alzaboxok” oldaláról — a böngészőben, az oldal
// saját (nyilvános) listájából. A scripts/box-sync.sh illeszti be az egyszer használható jegyet,
// és a kész kódot a napi ütemezett futás az alza.hu fülön futtatja le.
//  - a teljes lista (név, cím, koordináta) minden nap: ebből derül ki az új és a megszűnt box
//  - részletek (fotó → kód, „hol található” leírás) csak az új boxokra + naponta 25 régire (frissen tartás)
//  - az eredményt közvetlenül a box-sync függvénynek adja át; állapot: window.__boxSync
window.__boxSync = { phase: 'start', listed: 0, need: 0, done: 0, errors: 0, result: null, error: null };
(async () => {
  const S = window.__boxSync;
  const EP = 'https://jmhqsfeqfghzxsyqjgjd.supabase.co/functions/v1/box-sync';
  const T = '__TICKET__';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = async (body) => {
    const r = await fetch(EP, { method: 'POST', headers: { 'content-type': 'application/json', 'x-box-sync-ticket': T }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('box-sync ' + r.status + ': ' + (j.error || ''));
    return j;
  };
  const getJson = async (url) => {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('alza.hu ' + r.status + ' — ' + url.slice(0, 70));
    if (!/json/i.test(r.headers.get('content-type') || '')) throw new Error('alza.hu nem adatot adott vissza (ellenőrző oldal?)');
    return r.json();
  };
  const codeOf = (photo) => {
    if (!photo) return null;
    const m = photo.match(/\/([A-Za-z]{1,3}\d{2,6}[a-z]?)(?:_\d+)?\.[a-zA-Z]+(?:\?.*)?$/);
    if (m) return m[1].toUpperCase();
    let fn = '';
    try { fn = decodeURIComponent(photo.split('/').pop() || ''); } catch (_) { fn = photo.split('/').pop() || ''; }
    const m2 = fn.match(/^([A-Za-z]{1,3}\d{2,6}[a-z]?)(?![A-Za-z0-9])/);
    return m2 ? m2[1].toUpperCase() : null;
  };
  try {
    S.phase = 'known';
    const known = await api({ action: 'known' });
    const complete = new Set(known.complete || []);
    const stale = new Set(known.stale || []);

    S.phase = 'list';
    const list = [];
    for (let off = 0; off < 5000; off += 100) {
      const j = await getJson('/api/salesNetwork/v1/places?types[0]=1&ordering=0&latitude=47.4979&longitude=19.0402&radius=300000&limit=100&offset=' + off);
      const v = (j.pickupPlaces && j.pickupPlaces.value) || j.value || [];
      list.push(...v);
      if (v.length < 100) break;
      await sleep(150);
    }
    const seen = new Set();
    const items = list.filter((p) => p && p.type === 1 && p.parcelShopId && !seen.has(p.parcelShopId) && seen.add(p.parcelShopId));
    S.listed = items.length;
    if (items.length < 100) throw new Error('Gyanúsan rövid lista az alza.hu-ról: ' + items.length + ' box');
    const rows = items.map((p) => ({
      psid: p.parcelShopId, _did: p.deliveryId, name: p.name, address: p.addressText || null,
      lat: p.gpsPosition ? p.gpsPosition.latitude : null, lng: p.gpsPosition ? p.gpsPosition.longitude : null,
      detail: false, code: null, photo: null, article: null, desc: null,
    }));

    // részletek: az új (még nem ellenőrzött) boxok — futásonként legfeljebb 150 —, plusz a 25 legrégebben ellenőrzött
    const need = rows.filter((r) => !complete.has(r.psid)).slice(0, 150).concat(rows.filter((r) => stale.has(r.psid)));
    S.need = need.length; S.phase = 'detail';
    let i = 0;
    const worker = async () => {
      while (i < need.length) {
        const row = need[i++];
        try {
          const d = await getJson('/api/salesNetwork/v1/places/' + row._did + '/' + row.psid);
          row.photo = (d.detail && d.detail.imgUrl) || null;
          row.code = codeOf(row.photo);
          row.article = d.articleUrl || (d.detailAction && d.detailAction.href) || null;
          if (row.article) {
            const html = await fetch(row.article).then((r) => (r.ok ? r.text() : ''));
            const el = html ? new DOMParser().parseFromString(html, 'text/html').querySelector('.adrArticle') : null;
            row.desc = el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
          }
          row.detail = true;
        } catch (e) { S.errors++; }
        S.done++;
        await sleep(200);
      }
    };
    await Promise.all([worker(), worker()]);

    S.phase = 'import';
    S.result = await api({ action: 'import', rows: rows.map(({ _did, ...r }) => r) });
    S.phase = 'done';
  } catch (e) {
    S.error = String((e && e.message) || e).slice(0, 300);
    S.phase = 'failed';
    try { await api({ action: 'log', note: S.error }); } catch (_) { /* a naplózás sem ment */ }
  }
})();
'box-sync elindítva'
