// Telefonszám egységes nemzetközi (+ország…) alakra hozása — regisztrációnál, meghívónál és a
// Profilon ugyanaz a szabály. Érvénytelen bevitelre null.
import { huMobileE164 } from '../../supabase/functions/alarm-call/helpers'

export const PHONE_PLACEHOLDER = '+36 30 123 4567'
export const PHONE_ERROR = 'Adj meg egy érvényes telefonszámot, például: +36 30 123 4567'

export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null
  // magyar mobil: a legtöbb beírási módot elfogadjuk (06 30…, +36 30…, 30/123-4567)
  const mobile = huMobileE164(input)
  if (mobile) return mobile
  let d = input.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = '+' + d.slice(1).replace(/\+/g, '')
  else if (d.startsWith('00')) d = '+' + d.slice(2)
  else if (d.startsWith('06')) d = '+36' + d.slice(2)
  else return null // országhívó (vagy magyar 06) nélkül nem egyértelmű
  if (d.startsWith('+36')) {
    // mobil-előhívóval, de hibás hosszal: elírás (a jó mobilt fent már elfogadtuk)
    if (/^\+36(20|30|31|50|70)/.test(d)) return null
    return /^\+36\d{8}$/.test(d) ? d : null // vezetékes: körzetszámmal együtt 8 számjegy
  }
  return /^\+[1-9]\d{7,14}$/.test(d) ? d : null
}

// Megjelenítés: a magyar mobil tagolva, a többi úgy, ahogy mentve van
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return ''
  const m = e164.match(/^\+36(\d{2})(\d{3})(\d{4})$/)
  return m ? `+36 ${m[1]} ${m[2]} ${m[3]}` : e164
}
