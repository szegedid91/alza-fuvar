import { TEST_MODE, testLog } from './testMode'
import { isIOS, isPhone } from './device'

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

// Az app SAJÁT sémája (telefonon): az app közvetlenül indul, a böngészőben nem nyílik új lap.
// (A webes link új lapon nyílt, a telefon átadta az appnak, és a Chrome-ban ott maradt egy üres fehér lap.)
// Waze: waze:// · Google Maps: Androidon google.navigation: (rögtön navigál), iPhone-on comgooglemaps://
export function navSchemeUrl(app: NavApp, lat: number, lng: number, ios: boolean): string {
  if (app === 'waze') return `waze://?ll=${lat},${lng}&navigate=yes`
  return ios ? `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving` : `google.navigation:q=${lat},${lng}&mode=d`
}

type LaunchDeps = { phone?: boolean; ios?: boolean; go?: (url: string) => void; open?: (url: string) => void }

// A navigáció elindítása — CSAK a koppintáson belül hívható (különben a telefon rákérdez).
// Telefonon az app sémájával, ugyanazon a lapon (a mi oldalunk megmarad, nincs új lap);
// gépen a webes térkép nyílik új lapon. Igazat ad, ha ő intézte (a hívó link ne nyisson még egyet).
export function launchNav(app: NavApp, lat: number, lng: number, deps: LaunchDeps = {}): boolean {
  const injected = !!(deps.go || deps.open)
  // Gépi tesztmód (csak localhoston): a térkép nem nyílik meg — a tesztpanel megmutatja, hova indult volna
  if (import.meta.env.DEV && TEST_MODE && !injected) { testLog('nav', `Navigáció indulna (${NAV_LABEL[app]})`, `GPS-koordináta: ${lat}, ${lng}`, navUrl(app, lat, lng)); return true }
  if (deps.phone ?? isPhone()) {
    const go = deps.go ?? ((u: string) => { window.location.href = u })
    go(navSchemeUrl(app, lat, lng, deps.ios ?? isIOS()))
    return true
  }
  if (!injected) return false // gépen a link maga nyílik új lapon (a hívó <a> eleme intézi)
  ;(deps.open ?? (() => undefined))(navUrl(app, lat, lng))
  return true
}

// Automatikus megnyitás a „Kész, következő” után. Ha az automatika ki van kapcsolva vagy nincs koordináta, nem csinál semmit.
export function openNav(target: NavTarget | null | undefined, deps: LaunchDeps & { app?: NavApp; auto?: boolean } = {}): boolean {
  if (!target || !(deps.auto ?? getAutoNav())) return false
  const app = deps.app ?? getNavApp()
  if (launchNav(app, target.lat, target.lng, deps)) return true
  // gépen: a webes térkép új lapon
  window.open(navUrl(app, target.lat, target.lng), '_blank', 'noopener')
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

// „Kiindultam” után: a koppintás a WhatsAppot nyitja (a telefon egy koppintásból csak EGY appot enged megnyitni),
// ezért a navigáció nem indulhat ugyanabból az érintésből. Helyette megjegyezzük, hogy indulni kell: amikor a futár
// visszavált az appba, a járat-kártya teljes képernyős „Navigáció indítása” gombot mutat — egy koppintás, és megy.
const PROMPT_KEY = 'nav-after-depart'
const PROMPT_FRESH_MS = 15 * 60_000
export const PROMPT_EVENT = 'nav-prompt'
export function requestNavPrompt(now: number = Date.now()) {
  if (!getAutoNav()) return
  try { sessionStorage.setItem(PROMPT_KEY, String(now)) } catch { /* nem kritikus */ }
  // ha a járat-kártya már látszik (pl. ismételt jelzés), azonnal értesül
  try { window.dispatchEvent(new Event(PROMPT_EVENT)) } catch { /* nincs ablak (teszt) */ }
}
export function navPromptPending(now: number = Date.now()): boolean {
  try {
    const t = Number(sessionStorage.getItem(PROMPT_KEY) ?? 0)
    return t > 0 && now - t >= 0 && now - t < PROMPT_FRESH_MS
  } catch { return false }
}
export function clearNavPrompt() {
  try { sessionStorage.removeItem(PROMPT_KEY) } catch { /* nem kritikus */ }
}
