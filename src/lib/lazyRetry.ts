import { lazy, type ComponentType } from 'react'
import { errMsg } from './errors'
import { forceUpdate } from './swUpdate'

// Lusta oldalbetöltés újratöltéssel: friss verzió kitelepítése után a régi
// index még a régi chunk-neveket kéri (404 → „Failed to fetch dynamically
// imported module”). Ilyenkor egyszer újratöltjük az oldalt — a friss index már
// a jó fájlokat kéri. Egy kulcs védi a végtelen ciklust.
export function lazyRetry<T extends ComponentType<unknown>>(factory: () => Promise<{ default: T }>, name: string) {
  return lazy(async () => {
    const key = `alza-chunk-reload:${name}`
    try {
      const mod = await factory()
      try { sessionStorage.removeItem(key) } catch { /* privát mód */ }
      return mod
    } catch (e) {
      const msg = errMsg(e, 'ismeretlen hiba')
      let already = false
      try { already = sessionStorage.getItem(key) === '1'; if (!already) sessionStorage.setItem(key, '1') } catch { /* privát mód */ }
      if (/dynamically imported module|Importing a module script failed|Failed to fetch|Load failed/i.test(msg) && !already && navigator.onLine) {
        // A régi index a már nem létező chunkot kéri (új kitelepítés): a sima újratöltés a
        // service worker régi index.html-jét adná vissza — ezért SW-frissítés + cache-ürítés + újratöltés
        void forceUpdate()
        // amíg az újratöltés megtörténik, ne dobjunk hibát a felületre
        return new Promise<{ default: T }>(() => {})
      }
      if (!navigator.onLine) throw new Error('Nincs hálózat — az oldal ezen része még nincs letöltve. Kapcsolódj, és próbáld újra.')
      throw e
    }
  })
}
