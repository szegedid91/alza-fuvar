// A riasztás-hívás tiszta (hálózat nélküli) segédei — az app tesztjei is ezeket futtatják.

// Csak magyar mobilszám hívható (visszaélés és emelt díjas számok ellen): +36 20/30/31/50/70 + 7 számjegy.
// Elfogadott beírások: "+36 30 123 4567", "06301234567", "0036-30-1234567", "36301234567", "30/123-4567".
export function huMobileE164(input: string | null | undefined): string | null {
  if (!input) return null
  let d = input.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1).replace(/\+/g, '')
  else if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('06')) d = '36' + d.slice(2)
  else if (/^(20|30|31|50|70)\d{7}$/.test(d)) d = '36' + d
  return /^36(20|30|31|50|70)\d{7}$/.test(d) ? '+' + d : null
}

// "+36301234567" → "+36 30 ••• 4567" (naplóba és a felületre)
export function maskPhone(e164: string): string {
  const m = e164.match(/^\+36(\d{2})\d{3}(\d{4})$/)
  return m ? `+36 ${m[1]} ••• ${m[2]}` : '•••'
}

export const xmlEsc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

// A felolvasáshoz: zárójeles rész és írásjelek nélkül (pl. „Teszt Sofőr (dev)” → „Teszt Sofőr”)
export function spokenName(name: string): string {
  return name.replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N} .-]/gu, ' ').replace(/\s+/g, ' ').trim()
}

const SAY = (text: string) => `<Say language="hu-HU" voice="Google.hu-HU-Standard-B">${xmlEsc(text)}</Say>`

// A riasztás-hívás szövege: kik hiányoznak (legfeljebb 6 név), kétszer elmondva; az 1-es gomb leállítja.
export function alarmTwiml(names: string[], actionUrl: string): string {
  const spoken = names.map(spokenName).filter(Boolean)
  const n = spoken.length
  const list = spoken.slice(0, 6).join(', ') + (n > 6 ? `, és még ${n - 6} fő` : '')
  const msg = n > 0
    ? `Alza riasztás. ${n} munkatárs nem jelezte, hogy elindult a munkába: ${list}.`
    : 'Alza riasztás. Van munkatárs, aki nem jelezte, hogy elindult a munkába.'
  const stop = 'A riasztás leállításához nyomd meg az egyes gombot.'
  return '<?xml version="1.0" encoding="UTF-8"?><Response>'
    + `<Gather numDigits="1" timeout="6" method="POST" action="${xmlEsc(actionUrl)}">`
    + SAY(`${msg} ${stop}`) + '<Pause length="1"/>' + SAY(`Ismétlem. ${msg} ${stop}`)
    + '</Gather>'
    + SAY('Nem érkezett megerősítés. A riasztás tovább szól, amíg meg nem nyitod az alkalmazást.')
    + '</Response>'
}

export function testTwiml(): string {
  return '<?xml version="1.0" encoding="UTF-8"?><Response>'
    + SAY('Ez az Alza fuvarszervező próbahívása. Ha ezt hallod, a riasztás-hívás működik. Viszonthallásra.')
    + '</Response>'
}

// Válasz a gombnyomásra
export function ackTwiml(stopped: boolean): string {
  return '<?xml version="1.0" encoding="UTF-8"?><Response>'
    + SAY(stopped ? 'Köszönöm. A riasztás leállítva. A részleteket az alkalmazásban látod.' : 'Nem az egyes gombot nyomtad meg. A riasztás tovább szól, amíg meg nem nyitod az alkalmazást.')
    + '</Response>'
}
