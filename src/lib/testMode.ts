// TESZTMÓD — a futár napja a gépen is végigpróbálható (telefon nélkül).
// CSAK a fejlesztői szerveren, localhoston él (`npm run dev`): az éles buildben a TEST_MODE mindig hamis,
// és a hívási helyek `import.meta.env.DEV &&` feltétele miatt a tesztkód bele sem kerül a csomagba.
//
// Mit ad:
//  • álkamera (tesztkép vagy fájlból választott kép) — a böngésző-panelben nincs kamera
//  • a WhatsApp és a navigáció NEM nyílik meg: helyette látszik, mi ment volna ki és hova
//  • tesztpanel: a tesztnap újraindítása, fiókváltás, az „elküldött” üzenetek listája
import { useSyncExternalStore } from 'react'

const isLocalHost =
  typeof window !== 'undefined' &&
  (['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) || window.location.hostname.endsWith('.localhost'))

export const TEST_MODE: boolean = import.meta.env.DEV && import.meta.env.MODE !== 'test' && isLocalHost

// ── Mi ment volna ki (WhatsApp-üzenet, megosztás, navigáció) ────────────────────────────────
export type TestEventKind = 'whatsapp' | 'share' | 'nav'
export interface TestEvent { id: number; kind: TestEventKind; title: string; body: string; url?: string; at: Date }

let events: TestEvent[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function testLog(kind: TestEventKind, title: string, body: string, url?: string) {
  events = [{ id: ++seq, kind, title, body, url, at: new Date() }, ...events].slice(0, 50)
  emit()
}
export function clearTestEvents() { events = []; emit() }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export function useTestEvents(): TestEvent[] {
  return useSyncExternalStore(subscribe, () => events, () => events)
}

// ── Álkamera ───────────────────────────────────────────────────────────────────────────────
const REAL_CAM_KEY = 'test-real-camera'
export function getUseRealCamera(): boolean { try { return localStorage.getItem(REAL_CAM_KEY) === '1' } catch { return false } }
export function setUseRealCamera(on: boolean) { try { localStorage.setItem(REAL_CAM_KEY, on ? '1' : '0') } catch { /* nem kritikus */ } }

// A fájlból választott kép: az álkamera ezt „látja” (pl. egy valódi box-kijelző fotója a kiolvasás teszteléséhez)
let chosen: HTMLImageElement | null = null
let chosenName: string | null = null
export function testCameraImageName(): string | null { return chosenName }
export function setTestCameraImage(file: File | null): Promise<void> {
  if (!file) { chosen = null; chosenName = null; emit(); return Promise.resolve() }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => { chosen = img; chosenName = file.name; emit(); resolve() }
    img.onerror = () => reject(new Error('A kép nem olvasható'))
    img.src = URL.createObjectURL(file)
  })
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, w, h)
  if (chosen) {
    const s = Math.min(w / chosen.naturalWidth, h / chosen.naturalHeight)
    const iw = chosen.naturalWidth * s, ih = chosen.naturalHeight * s
    ctx.drawImage(chosen, (w - iw) / 2, (h - ih) / 2, iw, ih)
  } else {
    const bars = ['#f8fafc', '#facc15', '#22d3ee', '#22c55e', '#e879f9', '#ef4444', '#3b82f6']
    bars.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect((w / bars.length) * i, 0, w / bars.length + 1, h * 0.28) })
    ctx.fillStyle = '#f8fafc'; ctx.textAlign = 'center'
    ctx.font = `800 ${Math.round(w * 0.15)}px system-ui, sans-serif`
    ctx.fillText('TESZTKÉP', w / 2, h * 0.52)
    ctx.font = `600 ${Math.round(w * 0.04)}px system-ui, sans-serif`
    ctx.fillText('álkamera — a gépen nincs valódi kamera', w / 2, h * 0.52 + w * 0.09)
  }
  // idő-bélyeg: minden „fotó” más, és látszik, mikor készült
  const stamp = `Tesztmód · ${new Date().toLocaleString('hu-HU')}`
  ctx.font = `600 ${Math.round(w * 0.035)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(15,23,42,0.75)'; ctx.fillRect(0, h - w * 0.08, w, w * 0.08)
  ctx.fillStyle = '#f8fafc'; ctx.fillText(stamp, w / 2, h - w * 0.028)
}

export function fakeCameraStream(): MediaStream {
  const canvas = document.createElement('canvas')
  // álló képernyőn (telefon-méret) álló kép, különben fekvő — így a felirat nem lóg ki a keresőből
  const portrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth
  canvas.width = portrait ? 720 : 1280; canvas.height = portrait ? 1280 : 720
  const ctx = canvas.getContext('2d')!
  draw(ctx, canvas.width, canvas.height)
  const stream = canvas.captureStream(10)
  const timer = setInterval(() => {
    if (stream.getTracks().every((t) => t.readyState === 'ended')) { clearInterval(timer); return }
    draw(ctx, canvas.width, canvas.height)
  }, 200)
  return stream
}
