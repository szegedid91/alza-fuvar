// Service worker frissítés: az új verzió NEM tölti újra magától az oldalt
// (gépelés közben elveszne pl. a beírt kapott összeg), hanem egy sávot mutat,
// és a felhasználó dönt, mikor frissít.
import { useSyncExternalStore } from 'react'

type UpdateFn = (reload?: boolean) => Promise<void>
let pendingUpdate: UpdateFn | null = null
const listeners = new Set<() => void>()

export function setPendingUpdate(fn: UpdateFn | null): void {
  pendingUpdate = fn
  listeners.forEach((l) => l())
}

export function usePendingUpdate(): UpdateFn | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => pendingUpdate,
  )
}
