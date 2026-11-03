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

// Kényszerített frissítés: a várakozó SW-nek SKIP_WAITING, a precache törlése, és
// MINDENKÉPP újratöltés (ha a controllerchange nem jönne, akkor is).
export async function forceUpdate(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.update().catch(() => undefined)
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' })
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => !k.includes('supabase-storage')).map((k) => caches.delete(k)))
    }
  } catch { /* az újratöltés attól még megy */ }
  await new Promise((r) => setTimeout(r, 500))
  window.location.reload()
}

// Verzió-figyelő a service workertől FÜGGETLENÜL: a /version.json (no-store) build-idejét
// hasonlítja a futó buildhez — ha eltér, a sáv megjelenik, és a frissítés kényszerített.
// (Telefonon a SW-frissítés néha elakad; ez a kerülőút mindig működik.)
let watching = false
export function startVersionWatch(currentBuild: string): void {
  if (watching) return
  watching = true
  const check = async () => {
    if (!navigator.onLine) return
    try {
      const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!r.ok) return
      const j = (await r.json()) as { build?: string }
      if (j.build && j.build !== currentBuild && !pendingUpdate) setPendingUpdate(() => forceUpdate())
    } catch { /* offline / átmeneti hiba */ }
  }
  void check()
  setInterval(() => void check(), 5 * 60_000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check() })
}
