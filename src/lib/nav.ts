// Navigáció: a cím SZÖVEGÉT adjuk át (nem geokódolunk) — így a koszos címeknél is robusztus.

export type NavApp = 'google' | 'waze' | 'apple'

export function stopAddressText(s: {
  address_override?: string | null
  street?: string | null
  postal_code?: string | null
  city?: string | null
}): string {
  if (s.address_override && s.address_override.trim()) return s.address_override.trim()
  return [s.street, [s.postal_code, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
}

export function navUrl(app: NavApp, address: string): string {
  const q = encodeURIComponent(address)
  switch (app) {
    case 'google':
      return `https://www.google.com/maps/dir/?api=1&destination=${q}`
    case 'waze':
      return `https://waze.com/ul?q=${q}&navigate=yes`
    case 'apple':
      return `https://maps.apple.com/?daddr=${q}`
  }
}

export const navAppLabel: Record<NavApp, string> = {
  google: 'Google Maps',
  waze: 'Waze',
  apple: 'Apple Maps',
}
