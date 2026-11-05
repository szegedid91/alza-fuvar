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

// A legújabb, már letöltött (várakozó) service worker megvárása.
// FONTOS: ha a frissítés-keresés pillanatában egy régebbi verzió már várakozik, ÉS közben egy még
// újabb települ (két élesítés gyors egymásutánban), a régebbit NEM szabad azonnal aktiválni: az
// aktiválása kitakarítja a gyorsítótárból mindazt, ami nem az övé — köztük a települő újabb verzió
// már letöltött fájljait (a kezdőlapját is). Az újabb verzió így csonka gyorsítótárral aktiválódna
// később, és az oldal elérhetetlenné válna („a webhely nem érhető el”). Ezért előbb megvárjuk a
// telepítés végét, és csak a legújabbat aktiváljuk. Ha a telepítés nem ér véget időben, nem
// aktiválunk semmit (null) — a hívó sima újratöltést csinál.
type WorkerLike = Pick<ServiceWorker, 'state' | 'addEventListener' | 'removeEventListener'>
export interface RegistrationLike { installing: WorkerLike | null; waiting: WorkerLike | null }
export async function waitForNewestWorker<R extends RegistrationLike>(reg: R, timeoutMs = 25_000): Promise<R['waiting']> {
  const sw = reg.installing
  if (sw) {
    const finished = await new Promise<boolean>((resolve) => {
      const check = () => { if (sw.state !== 'installing') { clearTimeout(t); sw.removeEventListener('statechange', check); resolve(true) } }
      const t = setTimeout(() => { sw.removeEventListener('statechange', check); resolve(false) }, timeoutMs)
      sw.addEventListener('statechange', check)
      check()
    })
    if (!finished || reg.installing) return null
  }
  return reg.waiting
}

// Kényszerített frissítés — gyorsítótár-törlés NÉLKÜL (az tette elérhetetlenné az oldalt
// telefonon: a félig letöltött új SW mellett az oldal cache nélkül maradt).
// 1) SW-frissítés keresése, 2) megvárjuk, míg a LEGÚJABB SW teljesen letöltődik (precache),
// 3) SKIP_WAITING, 4) amikor az aktiválása befejeződött, újratöltünk; ha nincs új SW, sima újratöltés.
export async function forceUpdate(): Promise<void> {
  if (!navigator.onLine) return
  const reload = () => window.location.reload()
  let reg: ServiceWorkerRegistration | undefined
  try { reg = await navigator.serviceWorker?.getRegistration() } catch { /* nincs SW */ }
  if (!reg) { reload(); return }
  try { await reg.update() } catch { /* hálózati hiba — alább sima újratöltés */ }
  const waiting = await waitForNewestWorker(reg)
  if (!waiting) { reload(); return }
  // az új SW átveszi az oldalt; az újratöltéssel megvárjuk, míg az aktiválása (a régi fájlok
  // kitakarítása) befejeződik — biztonsági tartalék, ha az esemény elmaradna
  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    waiting.addEventListener('statechange', () => { if (waiting.state === 'activated' || waiting.state === 'redundant') finish() })
    waiting.postMessage({ type: 'SKIP_WAITING' })
    setTimeout(finish, 6000)
  })
  reload()
}

// Sérült gyorsítótár felismerése: nincs előtöltött gyorsítótár, vagy hiányzik belőle a kezdőlap
// (ilyenkor az app offline nem indulna el, a régi verzióknál pedig online sem).
export function precacheLooksBroken(cacheNames: string[], entryUrls: string[]): boolean {
  if (!cacheNames.some((n) => n.startsWith('workbox-precache'))) return true
  return !entryUrls.some((u) => { try { const p = new URL(u).pathname; return p === '/' || p === '/index.html' } catch { return false } })
}

// Induláskor: ha az aktív service worker gyorsítótára sérült, a service workert leválasztjuk és
// újratöltünk — a friss regisztráció mindent újra letölt. Munkamenetenként legfeljebb egyszer,
// csak online, és csak akkor, ha épp nem fut telepítés / frissítés.
const HEAL_FLAG = 'alza-sw-heal'
export async function healBrokenPrecache(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator) || !('caches' in window) || !navigator.onLine) return
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg?.active || reg.active.state !== 'activated' || reg.installing || reg.waiting || !navigator.serviceWorker.controller) return
    const names = await caches.keys()
    const urls: string[] = []
    for (const n of names.filter((x) => x.startsWith('workbox-precache'))) urls.push(...(await (await caches.open(n)).keys()).map((r) => r.url))
    if (!precacheLooksBroken(names, urls)) { sessionStorage.removeItem(HEAL_FLAG); return }
    if (sessionStorage.getItem(HEAL_FLAG)) return
    sessionStorage.setItem(HEAL_FLAG, '1')
    await reg.unregister()
    window.location.reload()
  } catch { /* a javítás nem sikerült — az app így is fut tovább */ }
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
