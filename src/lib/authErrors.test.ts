import { describe, it, expect, vi } from 'vitest'
import { authErrorMessage, UserMessage } from './authErrors'

describe('authErrorMessage — belépés / regisztráció hibaüzenetei', () => {
  it('az app saját ellenőrző üzenete változatlanul megjelenik (nem „Nem sikerült”)', () => {
    expect(authErrorMessage(new UserMessage('Adj meg egy érvényes telefonszámot, például: +36 30 123 4567'))).toBe('Adj meg egy érvényes telefonszámot, például: +36 30 123 4567')
    expect(authErrorMessage(new UserMessage('A jelszó legalább 8 karakter legyen.'))).toBe('A jelszó legalább 8 karakter legyen.')
  })
  it('a szerver ismert hibái magyarul', () => {
    expect(authErrorMessage(new Error('Invalid login credentials'))).toBe('Hibás email cím vagy jelszó.')
    expect(authErrorMessage({ message: 'User already registered' })).toBe('Ezzel az email címmel már van fiók.')
    expect(authErrorMessage(new TypeError('Failed to fetch'))).toMatch(/Nincs kapcsolat/)
  })
  it('SEC-23: ismeretlen szerverhiba nem jelenik meg nyersen', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(authErrorMessage(new Error('duplicate key value violates unique constraint "profiles_pkey"'))).toBe('Nem sikerült — próbáld újra később.')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
