// Box-lap: csomagszintű eltérések és box-hiba bejelentések — típusok, címkék, csoportüzenet-sorok.
export type ItemKind = 'damaged' | 'unknown' | 'no_barcode' | 'mislabelled_crate' | 'placed_elsewhere' | 'complaint_pickup' | 'admin' | 'other'
export const ITEM_KINDS: { key: ItemKind; label: string; short: string; hint: string }[] = [
  { key: 'damaged', label: 'Sérült csomag', short: 'Sérült', hint: 'Nem helyezted be, mert sérült — fotó a sérülésről, visszaviszed' },
  { key: 'unknown', label: 'Ismeretlen csomag', short: 'Ismeretlen', hint: 'Nincs a listán, nem tudni, hova való — fotó a címkéről' },
  { key: 'no_barcode', label: 'Nincs vonalkód', short: 'Nincs vonalkód', hint: 'A címke hiányzik vagy olvashatatlan — fotó' },
  { key: 'mislabelled_crate', label: 'Rossz ládába címkézve', short: 'Rossz láda', hint: 'Másik box ládájában volt — pótolod a megfelelő boxnál' },
  { key: 'placed_elsewhere', label: 'Máshová berakva', short: 'Máshová', hint: 'Nem a tervezett boxba került — írd meg, hova' },
  { key: 'complaint_pickup', label: 'Reklamációs visszavét', short: 'Reklamáció', hint: 'A boxból kivett reklamációs csomag' },
  { key: 'admin', label: 'ADMIN csomag', short: 'ADMIN', hint: 'ADMIN jelölésű csomag — fotó a címkéről' },
  { key: 'other', label: 'Egyéb', short: 'Egyéb', hint: 'Más eltérés — írd le röviden' },
]
export const itemKindLabel = (k: string): string => ITEM_KINDS.find((x) => x.key === k)?.label ?? k
export const itemKindShort = (k: string): string => ITEM_KINDS.find((x) => x.key === k)?.short ?? k

export type IssueKind = 'not_opening' | 'scanner' | 'emergency' | 'no_new' | 'security' | 'other'
export const ISSUE_KINDS: { key: IssueKind; label: string; hint: string; urgent?: boolean }[] = [
  { key: 'not_opening', label: 'Nem nyílik a fiók', hint: 'A box nem nyitja a fiókot / nem engedi behelyezni' },
  { key: 'scanner', label: 'Szkenner hiba', hint: 'Nem olvassa a kódot, lefagy a kijelző' },
  { key: 'other', label: 'Egyéb hiba', hint: 'Más box-hiba — írd le röviden' },
]
// Korábban választható fajták — újat már nem lehet felvenni belőlük, de a régi bejelentések címkéje megmarad
const LEGACY_ISSUE_LABELS: Record<string, string> = { emergency: 'Emergency kidobott', no_new: 'Nem enged újat', security: 'Biztonsági esemény' }
export const issueKindLabel = (k: string): string => ISSUE_KINDS.find((x) => x.key === k)?.label ?? LEGACY_ISSUE_LABELS[k] ?? k

export interface StopItemLike { kind: string; package_code: string | null; note: string | null; return_to_depot: boolean }
// A csoportüzenet sorai a csomagszintű eltérésekből: „Sérült: 1612345678 (visszaviszem) — eltört a doboz”
export function itemLines(items: StopItemLike[]): string[] {
  return items.map((i) => `${itemKindShort(i.kind)}${i.package_code ? `: ${i.package_code}` : ''}${i.return_to_depot ? ' (visszaviszem)' : ''}${i.note?.trim() ? ` — ${i.note.trim()}` : ''}`)
}
// Csomagkód tisztítása: csak számjegyek és betűk, szóköz nélkül; üres → null
export function cleanPackageCode(s: string): string | null {
  const t = s.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  return t.length >= 4 ? t.slice(0, 32) : null
}
// Box-hiba üzenet a csoportba (az Alza diszpécsernek)
export function issueMessage(p: { kind: string; boxLabel: string; at: Date; name: string; note?: string | null }): string {
  const hm = p.at.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
  return `Box-hiba – ${p.boxLabel} – ${issueKindLabel(p.kind)} – ${hm} – ${p.name}${p.note?.trim() ? `: ${p.note.trim()}` : ''}`
}
// Box-hiba statisztika: boxonként hány bejelentés, ebből hány biztonsági, utolsó időpont — a leggyakoribb elöl
export interface IssueRow { box_id: string | null; box_code: string | null; kind: string; created_at: string; resolved_at: string | null }
export interface IssueStat { key: string; label: string; total: number; open: number; security: number; last: string; kinds: Record<string, number> }
export function issueStats(rows: IssueRow[]): IssueStat[] {
  const m = new Map<string, IssueStat>()
  for (const r of rows) {
    const key = r.box_id ?? r.box_code ?? '?'
    let s = m.get(key)
    if (!s) { s = { key, label: r.box_code ?? 'ismeretlen box', total: 0, open: 0, security: 0, last: r.created_at, kinds: {} }; m.set(key, s) }
    s.total++; if (!r.resolved_at) s.open++; if (r.kind === 'security') s.security++
    s.kinds[r.kind] = (s.kinds[r.kind] ?? 0) + 1
    if (r.created_at > s.last) s.last = r.created_at
  }
  return [...m.values()].sort((a, b) => b.total - a.total || b.last.localeCompare(a.last))
}
