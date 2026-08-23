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
