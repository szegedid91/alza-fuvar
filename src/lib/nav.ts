// Navigációs app választás (eszközönként, a telefonon marad): Google Maps vagy Waze
export type NavApp = 'google' | 'waze'
const KEY = 'alza-nav-app'

export const NAV_LABEL: Record<NavApp, string> = { google: 'Google Maps', waze: 'Waze' }

export function getNavApp(): NavApp {
  try { return localStorage.getItem(KEY) === 'waze' ? 'waze' : 'google' } catch { return 'google' }
}

export function setNavApp(app: NavApp) {
  try { localStorage.setItem(KEY, app) } catch { /* privát mód — marad az alapértelmezés */ }
}

// Egy koppintásos útvonaltervezés az adott koordinátára (telefonon az app nyílik meg)
export function navUrl(app: NavApp, lat: number, lng: number): string {
  return app === 'waze'
    ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
}
