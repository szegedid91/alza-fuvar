// A „Segítséget kérek” képernyőtükör FOGADÓ oldali tisztítása (SEC-01).
// A futár eszköze küldi a saját DOM-ját; de a help_sessions sorba és a broadcast
// csatornára bárki írhat a saját JWT-jével, ezért a vezető oldalán SEMMIT nem
// bízunk a kapott HTML-re: csak megjelenítésre alkalmas elemek és attribútumok
// maradnak, szkript, beágyazás, navigáció, külső erőforrás nem.

const DROP_TAGS = new Set(['script', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base', 'form', 'template', 'noscript', 'applet', 'math', 'svg:script'])
const URL_ATTRS = new Set(['src', 'srcset', 'href', 'xlink:href', 'action', 'formaction', 'poster', 'background', 'ping', 'data'])
const SAFE_IMG_SRC = /^(https:\/\/[a-z0-9-]+\.supabase\.co\/|data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);|\/(?!\/))/i
// Keret-attribútumok (téma, nyelv): csak ezek mehetnek át a <html>/<body> elemre
const FRAME_ATTR_ALLOW = new Set(['class', 'lang', 'dir', 'data-theme', 'data-nav'])

function cleanStyle(value: string): string {
  // url(), @import, expression(), behavior: külső kérés / régi IE-futtatás nélkül
  return value.replace(/url\s*\([^)]*\)/gi, 'none').replace(/expression\s*\([^)]*\)/gi, '').replace(/@import[^;]*;?/gi, '').replace(/behavior\s*:[^;]*;?/gi, '')
}

export function sanitizeHelpHtml(html: string, doc: Document = document): string {
  const parser = new (doc.defaultView?.DOMParser ?? DOMParser)()
  const parsed = parser.parseFromString(`<body>${html}</body>`, 'text/html')
  const walker = parsed.createTreeWalker(parsed.body, 1 /* ELEMENT */)
  const toRemove: Element[] = []
  let el = walker.nextNode() as Element | null
  while (el) {
    const tag = el.tagName.toLowerCase()
    if (DROP_TAGS.has(tag)) { toRemove.push(el); el = walker.nextNode() as Element | null; continue }
    if (tag === 'style') {
      el.textContent = cleanStyle(el.textContent ?? '')
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc' || name === 'sandbox' || name === 'http-equiv' || name === 'contenteditable') { el.removeAttribute(attr.name); continue }
      if (name === 'style') { el.setAttribute('style', cleanStyle(attr.value)); continue }
      if (URL_ATTRS.has(name)) {
        const v = attr.value.trim()
        // kép-forrás: csak a saját Storage, beágyazott kép vagy relatív útvonal; minden más link semleges
        if ((name === 'src' || name === 'srcset') && (tag === 'img' || tag === 'image')) {
          if (!SAFE_IMG_SRC.test(v)) el.removeAttribute(attr.name)
        } else if (name === 'href' && tag === 'a') {
          el.setAttribute('href', '#')
        } else {
          el.removeAttribute(attr.name)
        }
      }
    }
    el = walker.nextNode() as Element | null
  }
  for (const n of toRemove) n.remove()
  return parsed.body.innerHTML
}

// `class="x" data-theme="dark"` → csak az engedélyezett attribútumok, értékük escape-elve
export function sanitizeFrameAttrs(attrs: string): string {
  const out: string[] = []
  for (const m of attrs.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
    const name = m[1].toLowerCase()
    if (!FRAME_ATTR_ALLOW.has(name)) continue
    const value = m[2].replace(/&quot;/g, '"').replace(/[^\w\s-]/g, '')
    out.push(`${name}="${value}"`)
  }
  return out.join(' ')
}

// A beágyazott dokumentum CSP-je: szkript, beágyazás, külső kapcsolat tiltva; csak a saját
// stíluslapok, a Storage-képek és a betűtípusok engedettek
export const HELP_FRAME_CSP = "default-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://*.supabase.co; font-src 'self' https://fonts.gstatic.com data:; form-action 'none'; base-uri 'none'"

export type FrameLike = { html: string; w: number; h: number; path: string; scroll: number; htmlAttrs: string; bodyAttrs: string; at: number }

// A broadcast payload alakjának ellenőrzése — ismeretlen/hiányos csomag eldobva
export function parseHelpFrame(p: unknown): FrameLike | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  if (typeof o.html !== 'string' || typeof o.w !== 'number' || typeof o.h !== 'number') return null
  const num = (v: unknown, d: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d)
  return {
    html: o.html.slice(0, 1_000_000),
    w: num(o.w, 390, 200, 4000),
    h: num(o.h, 760, 200, 8000),
    path: typeof o.path === 'string' ? o.path.slice(0, 300) : '/',
    scroll: num(o.scroll, 0, 0, 100_000),
    htmlAttrs: typeof o.htmlAttrs === 'string' ? o.htmlAttrs : '',
    bodyAttrs: typeof o.bodyAttrs === 'string' ? o.bodyAttrs : '',
    at: num(o.at, Date.now(), 0, Number.MAX_SAFE_INTEGER),
  }
}
