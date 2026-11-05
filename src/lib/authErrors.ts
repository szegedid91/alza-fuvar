// Belépés / regisztráció hibaüzenetei.
// Az app SAJÁT ellenőrző üzenetei (pl. hibás telefonszám, kiszivárgott jelszó) változatlanul
// megjelennek — ezeket UserMessage-ként dobjuk. A szerver ismert hibái magyarul; az ismeretlen
// szerverhibát nem mutatjuk nyersen (SEC-23: belső részletek), csak a konzolba kerül.
export class UserMessage extends Error {}

export function translateAuthError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Hibás email cím vagy jelszó.'
  if (m.includes('email not confirmed')) return 'Az email cím még nincs megerősítve.'
  if (m.includes('user already registered')) return 'Ezzel az email címmel már van fiók.'
  if (m.includes('password should be at least')) return 'A jelszó túl rövid (min. 8 karakter).'
  if (m.includes('unable to validate email')) return 'Érvénytelen email cím.'
  if (m.includes('rate limit') || m.includes('too many requests')) return 'Túl sok próbálkozás — várj pár percet, és próbáld újra.'
  if (m.includes('for security purposes')) return 'Biztonsági okból várni kell egy kicsit két kérés között — próbáld újra pár másodperc múlva.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Nincs kapcsolat — ellenőrizd a hálózatot, és próbáld újra.'
  console.error('Auth hiba:', msg)
  return 'Nem sikerült — próbáld újra később.'
}

export function authErrorMessage(err: unknown): string {
  if (err instanceof UserMessage) return err.message
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : (err as { message?: string } | null)?.message ?? 'Ismeretlen hiba'
  return translateAuthError(msg)
}
