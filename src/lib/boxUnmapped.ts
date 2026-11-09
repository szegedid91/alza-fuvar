// A Box-lap képkiolvasásakor talált, egyik mezőhöz sem sorolható kijelző-üzenetek kezelése:
// a megálló megjegyzésébe kerülnek (a futár és a vezető látja), és egy naplóba, amiből az admin
// látja, melyik üzenet hányszor fordul elő — ebből derül ki, kell-e rá új mező a lapon.

// Csoportosító kulcs: kisbetűs, írásjelek nélkül, egy szóközzel
export function unmappedKey(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

// A kiolvasó listájának tisztítása: üres / túl rövid / ismétlődő tételek ki, legfeljebb 8
export function cleanUnmapped(items: unknown): string[] {
  if (!Array.isArray(items)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    if (typeof raw !== 'string') continue
    const t = raw.replace(/\s+/g, ' ').trim().slice(0, 160)
    const k = unmappedKey(t)
    if (k.length < 3 || seen.has(k)) continue
    seen.add(k); out.push(t)
    if (out.length >= 8) break
  }
  return out
}

// A megálló megjegyzése kiegészítve a kijelző üzeneteivel — ami már benne van, nem kerül bele még egyszer
export function mergeStopNote(existing: string | null | undefined, items: string[]): string {
  const base = (existing ?? '').trim()
  const have = unmappedKey(base)
  const add = items.filter((t) => !have.includes(unmappedKey(t))).map((t) => `Kijelző: ${t}`)
  if (add.length === 0) return base
  return [base, ...add].filter(Boolean).join('\n')
}

export interface UnmappedRow { id: string; text: string; text_key: string; box_code: string | null; created_at: string; resolved_at: string | null }
export interface UnmappedGroup { key: string; text: string; count: number; boxes: string[]; first: string; last: string; ids: string[] }

// Üzenetenként: hányszor, mely boxoknál, mikor először / utoljára — a leggyakoribb elöl
export function groupUnmapped(rows: UnmappedRow[]): UnmappedGroup[] {
  const map = new Map<string, UnmappedGroup>()
  for (const r of rows) {
    if (r.resolved_at) continue
    let g = map.get(r.text_key)
    if (!g) { g = { key: r.text_key, text: r.text, count: 0, boxes: [], first: r.created_at, last: r.created_at, ids: [] }; map.set(r.text_key, g) }
    g.count++; g.ids.push(r.id)
    if (r.box_code && !g.boxes.includes(r.box_code)) g.boxes.push(r.box_code)
    if (r.created_at < g.first) g.first = r.created_at
    if (r.created_at > g.last) { g.last = r.created_at; g.text = r.text }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
}
