import { describe, expect, it } from 'vitest'
import { INVITE_MAIL_SUBJECT, inviteMailText, inviteMailto } from './inviteMail'

const base = { name: 'Preisinger Bendegúz', inviter: 'Szegedi Dániel', workspace: 'Alza', link: 'https://alza.szakify.hu/meghivo#123', expiresAt: '2026-12-09T10:00:00Z' }

describe('inviteMailText', () => {
  it('megszólítás, meghívó, link, érvényesség', () => {
    const t = inviteMailText(base)
    expect(t).toContain('Szia Preisinger Bendegúz!')
    expect(t).toContain('Szegedi Dániel meghívott az Utód Fuvarszervező appba (Alza).')
    expect(t).toContain('https://alza.szakify.hu/meghivo#123')
    expect(t).toContain('2026. 12. 09.-ig érvényes')
    expect(t).toContain('telefonszámodat és egy jelszót')
  })
  it('hiányzó adatok nélkül is értelmes', () => {
    const t = inviteMailText({ name: null, inviter: null, workspace: null, link: 'L', expiresAt: null })
    expect(t.startsWith('Szia!')).toBe(true)
    expect(t).toContain('A vezetőd meghívott az Utód Fuvarszervező appba.')
    expect(t).not.toContain('érvényes')
    expect(t).not.toContain('\n\n\n')
  })
})

describe('inviteMailto', () => {
  it('címzett, tárgy és törzs kódolva', () => {
    const m = inviteMailto('valaki@example.com', base)
    expect(m.startsWith('mailto:valaki%40example.com?subject=')).toBe(true)
    expect(decodeURIComponent(m.split('subject=')[1].split('&body=')[0])).toBe(INVITE_MAIL_SUBJECT)
    expect(decodeURIComponent(m.split('&body=')[1])).toContain('https://alza.szakify.hu/meghivo#123')
  })
})
