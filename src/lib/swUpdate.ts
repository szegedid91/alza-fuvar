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

// Kényszerített frissítés — gyorsítótár-törlés NÉLKÜL (az tette elérhetetlenné az oldalt
// telefonon: a félig letöltött új SW mellett az oldal cache nélkül maradt).
// 1) SW-frissítés keresése, 2) megvárjuk, míg az új SW letöltődik (precache), 3) SKIP_WAITING,
// 4) amikor átvette az oldalt (controllerchange) újratöltünk; ha nincs új SW, sima újratöltés.
export async function forceUpdate(): Promise<void> {
  if (!navigator.onLine) return
  const reload = () => window.location.reload()
  let reg: ServiceWorkerRegistration | undefined
  try { reg = await navigator.serviceWorker?.getRegistration() } catch { /* nincs SW */ }
  if (!reg) { reload(); return }
  try { await reg.update() } catch { /* hálózati hiba — alább sima újratöltés */ }
  // várakozás az új SW letöltésére (installing → installed/waiting), max 25 mp
  const waitInstalled = () => new Promise<ServiceWorker | null>((resolve) => {
    if (reg!.waiting) { resolve(reg!.waiting); return }
    const sw = reg!.installing
    if (!sw) { resolve(null); return }
    const t = setTimeout(() => resolve(reg!.waiting ?? null), 25000)
    sw.addEventListener('statechange', () => {
      if (sw.state === 'installed') { clearTimeout(t); resolve(sw) }
      else if (sw.state === 'redundant') { clearTimeout(t); resolve(null) }
    })
  })
  const waiting = await waitInstalled()
  if (!waiting) { reload(); return }
  // az új SW átveszi az oldalt → újratöltés; biztonsági tartalék, ha az esemény elmaradna
  let done = false
  const finish = () => { if (!done) { done = true; reload() } }
  navigator.serviceWorker.addEventListener('controllerchange', finish, { once: true })
  waiting.postMessage({ type: 'SKIP_WAITING' })
  setTimeout(finish, 4000)
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
