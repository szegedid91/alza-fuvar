// Kép tömörítése feltöltés előtt: átméretezés + JPEG minőség.
// Gyenge térerőnél / offline sorbaállításnál sokkal kevesebb adat.
export async function compressImage(blob: Blob, maxDim = 1600, quality = 0.6): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob)
    let { width, height } = bitmap
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    // ha a tömörítés nagyobb lenne (ritka), maradjon az eredeti
    return out && out.size < blob.size ? out : (out ?? blob)
  } catch {
    return blob // bármi hiba esetén az eredeti megy
  }
}

// Élő videó képkockája közvetlenül a végső méretben, EGY JPEG-kódolással.
// (Korábban: teljes felbontású JPEG → visszadekódolás → újrakódolás — gyenge
// telefonon másodpercekig tartott, az előnézet ezért jött lassan.)
export function captureVideoFrame(video: HTMLVideoElement, maxDim = 1600, quality = 0.6): Promise<Blob | null> {
  const vw = video.videoWidth, vh = video.videoHeight
  if (!vw || !vh) return Promise.resolve(null)
  const scale = Math.min(1, maxDim / Math.max(vw, vh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vw * scale)
  canvas.height = Math.round(vh * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}
