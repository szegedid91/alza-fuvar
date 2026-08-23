// Téma-kezelés: Rendszer / Világos / Sötét — a választás localStorage-ben,
// az aktív téma a <html data-theme="..."> attribútumon (index.css váltja a színeket).

export type ThemePref = 'system' | 'light' | 'dark'

const KEY = 'alza-theme'

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function setThemePref(pref: ThemePref): void {
  if (pref === 'system') localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, pref)
  apply()
}

function resolved(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function apply(): void {
  const t = resolved(getThemePref())
  document.documentElement.dataset.theme = t
  // A böngésző/PWA címsor színe kövesse a hátteret
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#eef1f6' : '#0b1220')
}

export function initTheme(): void {
  apply()
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getThemePref() === 'system') apply()
  })
}

export const themeLabel: Record<ThemePref, string> = {
  system: '🖥️ Rendszer',
  light: '☀️ Világos',
  dark: '🌙 Sötét',
}
