import { describe, expect, it } from 'vitest'
import { classifyUpload, mb, uploadType, MAX_UPLOAD_MB } from './mediaImport'

const MB = 1024 * 1024

describe('feltöltött felvétel besorolása', () => {
  it('kép és a három videóformátum mehet', () => {
    expect(classifyUpload('image/jpeg', 3 * MB)).toBe('image')
    expect(classifyUpload('image/heic', 3 * MB)).toBe('image')
    expect(classifyUpload('video/mp4', 20 * MB)).toBe('video')
    expect(classifyUpload('video/quicktime', 20 * MB)).toBe('video')
    expect(classifyUpload('video/webm;codecs=vp9', 20 * MB)).toBe('video')
  })
  it('a korlátnál nagyobb videó nem megy fel; a kép mérete nem számít (úgyis tömörítjük)', () => {
    expect(classifyUpload('video/mp4', MAX_UPLOAD_MB * MB)).toBe('video')
    expect(classifyUpload('video/mp4', MAX_UPLOAD_MB * MB + 1)).toBe('too_big')
    expect(classifyUpload('image/jpeg', 80 * MB)).toBe('image')
  })
  it('más fájl és más videóformátum nem tölthető fel', () => {
    expect(classifyUpload('application/pdf', MB)).toBe('unsupported')
    expect(classifyUpload('video/3gpp', MB)).toBe('unsupported')
    expect(classifyUpload('', MB, 'valami.bin')).toBe('unsupported')
  })
  it('üres típusnál a kiterjesztés dönt', () => {
    expect(uploadType('', 'VID_2026.MOV')).toBe('video/quicktime')
    expect(classifyUpload('', 10 * MB, 'visszaru.mp4')).toBe('video')
    expect(classifyUpload(null, 2 * MB, 'IMG_1.JPG')).toBe('image')
  })
  it('méret kiírása', () => {
    expect(mb(73 * MB)).toBe('73 MB')
    expect(mb(1000)).toBe('1 MB')
  })
})
