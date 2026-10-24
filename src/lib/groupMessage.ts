// Csoportba küldés — EGY helyen: ha később más csatorna lesz (egy szám,
// Telegram-bot), csak itt kell cserélni.
// Jelenleg: WhatsApp — a csoport-választó nyílik a KÉSZ szöveggel, a futár a
// csoportot választja és küld. (Csoporthoz a WhatsApp linkből nem enged előre
// kitöltött szöveget; a csoport-linkes + vágólapos mód a döntés szerint kikapcsolva.)
import type { Tables } from './database.types'

export type GroupWorkspace = Pick<Tables<'workspaces'>, 'arrival_whatsapp_group' | 'arrival_whatsapp_group_name'>

export const waUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`

export function groupTarget(_ws: GroupWorkspace | null | undefined, text: string): { url: string; viaClipboard: boolean; groupName: string | null } {
  return { url: waUrl(text), viaClipboard: false, groupName: null }
}

// Vágólapra másolás a koppintás pillanatában (csak felhasználói érintésre működik)
export function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false)
  } catch { /* alább a tartalék */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); ta.remove()
    return Promise.resolve(ok)
  } catch { return Promise.resolve(false) }
}

// Fotó + szöveg megosztása a telefon megosztás-menüjén át (WhatsApp → csoport).
// Csak a telefon natív megosztója tud képet átadni a WhatsAppnak.
export function canShareFiles(): boolean {
  try {
    const f = new File([new Blob(['x'])], 'x.jpg', { type: 'image/jpeg' })
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] })
  } catch { return false }
}
export async function sharePhotos(blobs: Blob[], text: string, baseName: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!canShareFiles() || blobs.length === 0) return 'unsupported'
  const files = blobs.map((b, i) => new File([b], `${baseName}-${i + 1}.jpg`, { type: b.type || 'image/jpeg' }))
  try {
    await navigator.share({ files, text })
    return 'shared'
  } catch (e) {
    return e instanceof Error && e.name === 'AbortError' ? 'cancelled' : 'unsupported'
  }
}

const dt = (d: Date) =>
  `${d.toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' })} ${d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}`

export type StatusKind = 'arrived' | 'departed' | 'done' | 'issue'
export const STATUS_META: Record<StatusKind, { label: string; title: string; icon: 'map-pin' | 'navigation' | 'flag' | 'alert-triangle'; color: string }> = {
  arrived: { label: 'Megérkeztem', title: 'Megérkeztem az Alzába', icon: 'map-pin', color: 'var(--success)' },
  departed: { label: 'Kiindultam', title: 'Kiindultam', icon: 'navigation', color: 'var(--primary)' },
  done: { label: 'Járat kész', title: 'Járat kész', icon: 'flag', color: 'var(--success)' },
  issue: { label: 'Hiba', title: 'Hiba', icon: 'alert-triangle', color: 'var(--danger)' },
}

// A csoportba menő szöveg: mi · mikor · ki (· autó) (· megjegyzés)
export function statusText(kind: StatusKind, at: Date, name: string, plate?: string | null, note?: string | null): string {
  const who = plate ? `${name} (${plate})` : name
  const base = `${STATUS_META[kind].title} – ${dt(at)} – ${who}`
  return note?.trim() ? `${base}: ${note.trim()}` : base
}
