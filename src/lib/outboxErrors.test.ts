import { describe, expect, it } from 'vitest'
import { isConnectionError, isRetryLater, isTransientServerError } from './outboxErrors'

describe('mentési sor — hibák besorolása', () => {
  it('szerver-kimaradás (5xx, 429, lejárt token) átmeneti: nem számít hibás próbálkozásnak', () => {
    expect(isTransientServerError({ message: 'Bad Gateway', httpStatus: 502 })).toBe(true)
    expect(isTransientServerError({ message: 'Service Unavailable', status: 503 })).toBe(true)
    expect(isTransientServerError({ message: 'Too Many Requests', statusCode: '429' })).toBe(true)
    expect(isTransientServerError({ message: 'JWT expired', code: 'PGRST301', httpStatus: 401 })).toBe(true)
    expect(isTransientServerError({ message: 'jwt expired', statusCode: '403' })).toBe(true)
  })
  it('adat- és jogosultsági hiba NEM átmeneti: számoljuk, a hívó megkapja', () => {
    expect(isTransientServerError({ message: 'new row violates row-level security policy', code: '42501', httpStatus: 403 })).toBe(false)
    expect(isTransientServerError({ message: 'duplicate key value violates unique constraint', code: '23505', httpStatus: 409 })).toBe(false)
    expect(isTransientServerError(new Error('A módosítandó sor nem található a szerveren'))).toBe(false)
  })
  it('az adatbázis saját időkorlátja nem átmeneti (az ismétlés ugyanúgy elhasalna)', () => {
    expect(isTransientServerError({ message: 'canceling statement due to statement timeout', code: '57014', httpStatus: 500 })).toBe(false)
    expect(isConnectionError({ message: 'canceling statement due to statement timeout' }, true)).toBe(false)
  })
  it('hálózati hiba és a saját időkorlátunk megszakítása: később újra', () => {
    expect(isConnectionError(new TypeError('Failed to fetch'), true)).toBe(true)
    expect(isConnectionError(new Error('Load failed'), true)).toBe(true)
    expect(isConnectionError({ message: 'AbortError: signal timed out' }, true)).toBe(true)
    expect(isConnectionError({ message: 'TimeoutError: The operation was aborted due to timeout' }, true)).toBe(true)
    expect(isConnectionError(new Error('bármi'), false)).toBe(true) // nincs net
    expect(isConnectionError(new TypeError('x is not a function'), true)).toBe(false) // programhiba ne akassza meg a sort
  })
  it('isRetryLater = hálózati VAGY átmeneti szerverhiba', () => {
    expect(isRetryLater({ message: 'Bad Gateway', httpStatus: 502 }, true)).toBe(true)
    expect(isRetryLater(new TypeError('Failed to fetch'), true)).toBe(true)
    expect(isRetryLater({ message: 'permission denied', code: '42501', httpStatus: 403 }, true)).toBe(false)
  })
})
