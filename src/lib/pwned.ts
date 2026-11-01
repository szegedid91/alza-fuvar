// Kiszivárgott jelszó ellenőrzése a HaveIBeenPwned nyilvános adatbázisával (k-anonimitás):
// a jelszó SHA-1 hash-ének csak az első 5 karaktere megy ki, a jelszó és a teljes hash
// sosem hagyja el a készüléket. Kulcs nem kell. Hálózati hiba esetén nem blokkol
// (a jelszó akkor is beállítható) — a szerveroldali védelem a Supabase Pro csomag része lenne.
export async function isPasswordPwned(password: string): Promise<{ pwned: boolean; count: number; checked: boolean }> {
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))
    const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    const prefix = hex.slice(0, 5), suffix = hex.slice(5)
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 6000)
    const r = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' }, signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) return { pwned: false, count: 0, checked: false }
    const text = await r.text()
    for (const line of text.split('\n')) {
      const [sfx, cnt] = line.trim().split(':')
      if (sfx === suffix) { const n = parseInt(cnt ?? '0', 10) || 0; return { pwned: n > 0, count: n, checked: true } }
    }
    return { pwned: false, count: 0, checked: true }
  } catch {
    return { pwned: false, count: 0, checked: false }
  }
}

export const PWNED_MESSAGE = 'Ez a jelszó szerepel ismert adatszivárgásokban, ezért nem használható. Válassz másikat (pl. három összefűzött szót).'
