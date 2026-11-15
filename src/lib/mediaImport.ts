// Kész felvétel (kép / videó) feltöltése a telefonról — az elszámolás visszáru-bizonyítékához,
// ha a futár a telefon saját kamerájával vette fel. Tiszta besorolás + a böngészős előkészítés.
import { compressImage, captureVideoFrame } from './image'
import { baseMime } from './media'

// a tároló fájlonkénti korlátja (photos bucket)
export const MAX_UPLOAD_MB = 50
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const EXT_TYPE: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' }

// A fájl típusa: a böngésző által adott, vagy (ha üres — néhány telefon fájlválasztója így adja) a kiterjesztésből
export function uploadType(type: string | null | undefined, name = ''): string {
  const t = baseMime(type)
  if (t) return t
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return EXT_TYPE[ext] ?? ''
}

export type UploadKind = 'image' | 'video' | 'too_big' | 'unsupported'
export function classifyUpload(type: string | null | undefined, sizeBytes: number, name = ''): UploadKind {
  const t = uploadType(type, name)
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) {
    if (!VIDEO_TYPES.includes(t)) return 'unsupported'
    return sizeBytes > MAX_UPLOAD_MB * 1024 * 1024 ? 'too_big' : 'video'
  }
  return 'unsupported'
}

export const mb = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`

// A videó hossza és egy képkockája (bélyegképnek). Ha a telefon nem ad képkockát, hossz / kép nélkül megy tovább.
export function videoMeta(file: Blob, timeoutMs = 6000): Promise<{ poster?: Blob; seconds?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.muted = true; v.playsInline = true; v.preload = 'auto'
    let done = false
    const dur = () => (Number.isFinite(v.duration) && v.duration > 0 ? Math.max(1, Math.round(v.duration)) : undefined)
    const finish = (r: { poster?: Blob; seconds?: number }) => {
      if (done) return
      done = true; clearTimeout(timer)
      URL.revokeObjectURL(url); v.removeAttribute('src')
      try { v.load() } catch { /* nem kritikus */ }
      resolve(r)
    }
    const timer = setTimeout(() => finish({ seconds: dur() }), timeoutMs)
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2) } catch { finish({ seconds: dur() }) } }
    v.onseeked = () => { void captureVideoFrame(v, 640, 0.7).then((p) => finish({ poster: p ?? undefined, seconds: dur() })).catch(() => finish({ seconds: dur() })) }
    v.onerror = () => finish({})
    v.src = url
  })
}

export type Imported = { blob: Blob; poster?: Blob; video: boolean; seconds?: number }

// Egy választott fájl előkészítése: a kép kisebbre tömörítve (JPEG), a videó változatlanul + bélyegkép.
// Hibánál a futárnak szóló rövid magyarázatot adja vissza.
export async function importFile(file: File): Promise<Imported | { error: string }> {
  const kind = classifyUpload(file.type, file.size, file.name)
  if (kind === 'too_big') return { error: `${file.name}: túl nagy videó (${mb(file.size)}) — legfeljebb ${MAX_UPLOAD_MB} MB tölthető fel. Vedd fel itt az appban (piros gomb), az kisebb fájl.` }
  if (kind === 'unsupported') return { error: `${file.name}: ez a fájltípus nem tölthető fel (kép vagy mp4 / mov videó kell).` }
  const type = uploadType(file.type, file.name)
  if (kind === 'video') {
    const meta = await videoMeta(file)
    // a típus biztosan legyen kitöltve (ebből lesz a kiterjesztés és a tároló is ezt ellenőrzi)
    const blob = baseMime(file.type) === type ? file : new Blob([file], { type })
    return { blob, video: true, poster: meta.poster, seconds: meta.seconds }
  }
  const jpg = await compressImage(file, 1600, 0.7)
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(baseMime(jpg.type))) return { error: `${file.name}: ezt a képet a telefon nem tudta átalakítani — készíts róla képernyőfotót, vagy fotózd le itt az appban.` }
  return { blob: jpg, video: false }
}
