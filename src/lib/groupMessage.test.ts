import { describe, expect, it, vi } from 'vitest'
import { openWhatsApp, waUrl, whatsappSchemeUrl } from './groupMessage'

describe('WhatsApp megnyitása', () => {
  it('a séma és a webes link ugyanazt a szöveget viszi', () => {
    expect(whatsappSchemeUrl('Járat kész – 10:00 – Elek')).toBe('whatsapp://send?text=J%C3%A1rat%20k%C3%A9sz%20%E2%80%93%2010%3A00%20%E2%80%93%20Elek')
    expect(waUrl('a b')).toBe('https://wa.me/?text=a%20b')
  })
  it('előbb az app sémája ugyanazon a lapon; ha az app elindult (a lap eltűnt), nincs új fül', async () => {
    vi.useFakeTimers()
    const go = vi.fn(); const open = vi.fn()
    openWhatsApp('szia', { go, open, isHidden: () => true, delayMs: 100, watch: () => () => undefined })
    expect(go).toHaveBeenCalledWith('whatsapp://send?text=szia')
    vi.advanceTimersByTime(200)
    expect(open).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
  it('ha az app nem indult el (a lap látható maradt), a wa.me nyílik új fülön', () => {
    vi.useFakeTimers()
    const go = vi.fn(); const open = vi.fn()
    openWhatsApp('szia', { go, open, isHidden: () => false, delayMs: 100, watch: () => () => undefined })
    vi.advanceTimersByTime(200)
    expect(open).toHaveBeenCalledWith('https://wa.me/?text=szia')
    vi.useRealTimers()
  })
  it('ha a lap közben háttérbe került (az app elindult), akkor sem nyílik fül, ha a várakozás végén már megint látszik', () => {
    vi.useFakeTimers()
    const go = vi.fn(); const open = vi.fn()
    let leave: (() => void) | null = null
    const stop = vi.fn()
    openWhatsApp('szia', { go, open, isHidden: () => false, delayMs: 100, watch: (onLeave) => { leave = onLeave; return stop } })
    leave!()
    vi.advanceTimersByTime(200)
    expect(open).not.toHaveBeenCalled()
    expect(stop).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
