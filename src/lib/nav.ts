// Navigációs app választás (eszközönként, a telefonon marad): Google Maps vagy Waze
export type NavApp = 'google' | 'waze'
const KEY = 'alza-nav-app'
const AUTO_KEY = 'alza-nav-auto'

export const NAV_LABEL: Record<NavApp, string> = { google: 'Google Maps', waze: 'Waze' }

export function getNavApp(): NavApp {
  try { return localStorage.getItem(KEY) === 'waze' ? 'waze' : 'google' } catch { return 'google' }
}

export function setNavApp(app: NavApp) {
  try { localStorage.setItem(KEY, app) } catch { /* privát mód — marad az alapértelmezés */ }
}

// Automatikus navigáció: a „Kész, következő” magától megnyitja és elindítja a navigációt a következő boxhoz.
// Alapból be van kapcsolva; a Profilban kikapcsolható (ezen a telefonon marad).
export function getAutoNav(): boolean {
  try { return localStorage.getItem(AUTO_KEY) !== '0' } catch { return true }
}

export function setAutoNav(on: boolean) {
  try { localStorage.setItem(AUTO_KEY, on ? '1' : '0') } catch { /* privát mód — marad az alapértelmezés */ }
}

// A navigáció célja MINDIG GPS-koordináta (a box-jegyzékből) — cím szerinti keresés nincs,
// így a térkép biztosan a boxhoz visz, nem egy hasonló nevű utcába.
export type NavTarget = { lat: number; lng: number }

export function navTargetOf(p: { lat: number | null; lng: number | null } | null | undefined): NavTarget | null {
  if (!p || p.lat == null || p.lng == null) return null
  const lat = Number(p.lat), lng = Number(p.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null
  return { lat, lng }
}

// Egy koppintásos navigáció az adott koordinátára (telefonon az app nyílik meg), és rögtön el is indul:
// Google Maps: dir_action=navigate · Waze: navigate=yes
export function navUrl(app: NavApp, lat: number, lng: number): string {
  return app === 'waze'
    ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving&dir_action=navigate`
}

// Automatikus megnyitás — CSAK a koppintáson belül hívható (különben a böngésző blokkolja / rákérdez).
// Igazat ad, ha megnyitotta. Ha az automatika ki van kapcsolva vagy nincs koordináta, nem csinál semmit.
export function openNav(target: NavTarget | null | undefined, deps: { open?: (url: string) => void; app?: NavApp; auto?: boolean } = {}): boolean {
  if (!target || !(deps.auto ?? getAutoNav())) return false
  const open = deps.open ?? ((url) => { window.open(url, '_blank', 'noopener') })
  open(navUrl(deps.app ?? getNavApp(), target.lat, target.lng))
  return true
}

// A Box-lap „Kész, következő box” gombjához: a járat-kártya adja át, hova kell utána navigálni.
// askLate: ha a box határideje lejárt és még nincs megadott késés-ok, a járat-kártya előbb az okot kéri —
// akkor a navigáció az ok mentésekor indul (ott is koppintás van), nem itt.
export type AfterFill = { boxId: string; nav: NavTarget | null; deadline: string | null; carryKey: string }

export function shouldNavAfterFill(after: AfterFill | null | undefined, boxId: string | null, deps: { lateMin?: (deadline: string | null) => number | null; hasCarry?: (key: string) => boolean } = {}): NavTarget | null {
  if (!after || !after.nav || !boxId || after.boxId !== boxId) return null
  const late = deps.lateMin?.(after.deadline) ?? null
  if (late != null && late > 0) {
    const hasCarry = deps.hasCarry ?? ((key: string) => { try { return (JSON.parse(sessionStorage.getItem(key) ?? '[]') as unknown[]).length > 0 } catch { return false } })
    if (!hasCarry(after.carryKey)) return null
  }
  return after.nav
}
