// A jelszó-visszaállító email linkje a címsor hash-ében hozza a tokent
// (#access_token=…&type=recovery), hibás/lejárt link esetén pedig a hibát
// (#error=…). A Supabase-kliens indulás után kitakarítja a hash-t, ezért
// modul-betöltéskor — a kliens inicializálása ELŐTT — eltesszük.
const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : ''
const params = new URLSearchParams(hash)

export const RECOVERY_IN_URL = params.get('type') === 'recovery'

// Emberi hibaüzenet lejárt vagy már felhasznált linkre
export const RECOVERY_URL_ERROR: string | null = (() => {
  const code = params.get('error_code')
  const err = params.get('error')
  if (!code && !err) return null
  if (code === 'otp_expired' || (params.get('error_description') ?? '').toLowerCase().includes('expired')) {
    return 'A jelszó-visszaállító link lejárt. Kérj újat a bejelentkezési oldalon.'
  }
  if (err === 'access_denied') return 'Ez a link már nem érvényes. Kérj újat a bejelentkezési oldalon.'
  return params.get('error_description') ?? err
})()

// A visszaállító útvonal — ide irányít az emailben lévő link
export const RECOVERY_PATH = '/jelszo-visszaallitas'
