import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { subscribeWithRetry, defaultRetryDelay, type ChannelStatus } from './realtimeRetry'

// Ál-csatorna: úgy viselkedik, mint az igazi — másodszori subscribe() hibát dob
class FakeChannel {
  static made: FakeChannel[] = []
  subscribes = 0
  removed = false
  cb: ((s: ChannelStatus) => void) | null = null
  constructor() { FakeChannel.made.push(this) }
  subscribe(cb: (s: ChannelStatus | string) => void) {
    if (++this.subscribes > 1) throw new Error("tried to join multiple times. 'join' can only be called a single time per channel instance")
    this.cb = cb
    return this
  }
  emit(s: ChannelStatus) { this.cb?.(s) }
}

describe('subscribeWithRetry — megszakadt Realtime-csatorna újranyitása', () => {
  let subscribed = 0
  const start = () => subscribeWithRetry({
    create: () => new FakeChannel(),
    remove: (ch) => { ch.removed = true },
    onSubscribed: () => { subscribed++ },
    delayMs: () => 3000,
  })
  beforeEach(() => { vi.useFakeTimers(); FakeChannel.made = []; subscribed = 0 })
  afterEach(() => { vi.useRealTimers() })

  it('lezárás után ÚJ csatornát nyit — a régire nem iratkozik fel másodszor', () => {
    start()
    const first = FakeChannel.made[0]
    first.emit('SUBSCRIBED')
    expect(subscribed).toBe(1)
    first.emit('CLOSED')
    expect(() => vi.advanceTimersByTime(3000)).not.toThrow()
    expect(FakeChannel.made).toHaveLength(2)
    expect(first.subscribes).toBe(1); expect(first.removed).toBe(true)
    FakeChannel.made[1].emit('SUBSCRIBED')
    expect(subscribed).toBe(2) // a kimaradt eseményeket pótló frissítés újra lefut
  })
  it('az eldobott példány kései jelzései nem indítanak újabb cserét', () => {
    start()
    const first = FakeChannel.made[0]
    first.emit('CHANNEL_ERROR'); first.emit('CLOSED') // két jelzés ugyanarról a szakadásról → egy csere
    vi.advanceTimersByTime(3000)
    expect(FakeChannel.made).toHaveLength(2)
    first.emit('CLOSED') // az eltávolítás visszahívása a régi példányon
    vi.advanceTimersByTime(10_000)
    expect(FakeChannel.made).toHaveLength(2)
  })
  it('leállítás után nincs több újranyitás, az élő csatorna eltávolítva', () => {
    const stop = start()
    FakeChannel.made[0].emit('TIMED_OUT')
    stop()
    vi.advanceTimersByTime(60_000)
    expect(FakeChannel.made).toHaveLength(1)
    expect(FakeChannel.made[0].removed).toBe(true)
  })
  it('tartós hibánál ritkul az újrapróbálkozás (legfeljebb 30 mp)', () => {
    expect([0, 1, 2, 3, 4, 9].map(defaultRetryDelay)).toEqual([3000, 6000, 12000, 24000, 30000, 30000])
  })
})
