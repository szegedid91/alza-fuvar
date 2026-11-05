// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { huMobileE164, maskPhone, spokenName, alarmTwiml, testTwiml, ackTwiml } from '../../supabase/functions/alarm-call/helpers'

const parse = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('hibás XML')
  return doc
}

describe('riasztás-hívás — csak magyar mobilszám hívható', () => {
  it('a szokásos beírások egységes nemzetközi alakra', () => {
    for (const s of ['+36 30 123 4567', '06301234567', '0036-30-1234567', '36301234567', '30/123-4567', '06 (30) 123-4567']) expect(huMobileE164(s)).toBe('+36301234567')
    expect(huMobileE164('+36 70 555 1234')).toBe('+36705551234')
  })
  it('vezetékes, emelt díjas, külföldi vagy hibás szám nem hívható', () => {
    for (const s of ['+36 1 234 5678', '06 90 123 456', '+44 7700 900123', '+1 555 123 4567', '0630123456', '063012345678', 'nincs', '', null, undefined]) expect(huMobileE164(s)).toBeNull()
  })
  it('a naplóban és a felületen a szám közepe takarva', () => {
    expect(maskPhone('+36301234567')).toBe('+36 30 ••• 4567')
    expect(maskPhone('valami')).toBe('•••')
  })
})

describe('riasztás-hívás — a felolvasott szöveg', () => {
  it('a nevekből kimarad a zárójeles rész és az írásjel', () => {
    expect(spokenName('Teszt Sofőr (dev)')).toBe('Teszt Sofőr')
    expect(spokenName('Szgd.Dnl <b>')).toBe('Szgd.Dnl b')
  })
  it('riasztás: magyar hang, a hiányzók neve, kétszer elmondva, az 1-es gomb a megadott címre megy', () => {
    const xml = alarmTwiml(['Nagy Gábor', 'Kiss "Peti" & társa'], 'https://x.supabase.co/functions/v1/alarm-call?a=1&k=abc')
    const doc = parse(xml)
    const gather = doc.querySelector('Gather')!
    expect(gather.getAttribute('numDigits')).toBe('1')
    expect(gather.getAttribute('action')).toBe('https://x.supabase.co/functions/v1/alarm-call?a=1&k=abc')
    const says = [...doc.querySelectorAll('Say')]
    expect(says).toHaveLength(3)
    for (const s of says) { expect(s.getAttribute('language')).toBe('hu-HU'); expect(s.getAttribute('voice')).toBe('Google.hu-HU-Standard-B') }
    expect(says[0].textContent).toContain('2 munkatárs nem jelezte, hogy elindult a munkába: Nagy Gábor, Kiss Peti társa.')
    expect(says[1].textContent).toMatch(/^Ismétlem\./)
    expect(xml.length).toBeLessThan(4000)
  })
  it('sok hiányzónál 6 név és a maradék száma; a szöveg a szolgáltató 4000 karakteres korlátja alatt marad', () => {
    const names = Array.from({ length: 30 }, (_, i) => `Nagyon Hosszú Nevű Munkatárs ${i + 1}`)
    const xml = alarmTwiml(names, 'https://x.supabase.co/functions/v1/alarm-call?a=11111111-1111-4111-8111-111111111111&k=' + 'a'.repeat(64))
    expect(parse(xml).querySelector('Say')!.textContent).toContain('és még 24 fő')
    expect(xml.length).toBeLessThan(4000)
  })
  it('próbahívás és a gombnyomás válasza jól formált', () => {
    expect(parse(testTwiml()).querySelector('Say')!.textContent).toContain('próbahívása')
    expect(parse(ackTwiml(true)).querySelector('Say')!.textContent).toContain('leállítva')
    expect(parse(ackTwiml(false)).querySelector('Say')!.textContent).toContain('tovább szól')
  })
})
