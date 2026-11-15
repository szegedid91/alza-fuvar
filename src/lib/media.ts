// Fájltípus-segédek (kép / videó) — tiszta függvények, hálózat nélkül.
export const isVideoPath = (path: string | null | undefined): boolean => !!path && /\.(mp4|webm|mov)$/i.test(path)
// "video/mp4;codecs=avc1.42E01E" → "video/mp4"
export const baseMime = (type: string | null | undefined): string => (type ?? '').split(';')[0].trim().toLowerCase()
export function mediaExt(type: string | null | undefined): 'jpg' | 'mp4' | 'webm' | 'mov' {
  const t = baseMime(type)
  return t === 'video/mp4' ? 'mp4' : t === 'video/webm' ? 'webm' : t === 'video/quicktime' ? 'mov' : 'jpg'
}
// Bélyegkép útvonala a teljes kép / videó mellett: {id}_t.jpg
export const thumbPath = (path: string): string => path.replace(/\.(jpg|mp4|webm|mov)$/i, '_t.jpg')
// A felvevő által támogatott első videóformátum (mp4 elöl: iPhone-on is lejátszható)
export const VIDEO_MIME_CANDIDATES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
// "0:07", "1:00"
export const fmtClock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
