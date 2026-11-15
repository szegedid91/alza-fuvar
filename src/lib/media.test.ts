import { describe, expect, it } from 'vitest'
import { baseMime, fmtClock, isVideoPath, mediaExt, thumbPath, VIDEO_MIME_CANDIDATES } from './media'

describe('média-segédek', () => {
  it('kiterjesztés a típusból (kodek-paraméterrel is)', () => {
    expect(mediaExt('video/mp4;codecs=avc1.42E01E')).toBe('mp4')
    expect(mediaExt('video/webm;codecs=vp9')).toBe('webm')
    expect(mediaExt('video/quicktime')).toBe('mov')
    expect(mediaExt('image/jpeg')).toBe('jpg')
    expect(mediaExt('')).toBe('jpg')
    expect(baseMime('Video/MP4; codecs=x')).toBe('video/mp4')
  })
  it('videó-útvonal és bélyegkép', () => {
    expect(isVideoPath('ws/status/e/a.mp4')).toBe(true)
    expect(isVideoPath('ws/status/e/a.jpg')).toBe(false)
    expect(isVideoPath(null)).toBe(false)
    expect(thumbPath('ws/x/a.jpg')).toBe('ws/x/a_t.jpg')
    expect(thumbPath('ws/x/a.mp4')).toBe('ws/x/a_t.jpg')
    expect(thumbPath('ws/x/a.webm')).toBe('ws/x/a_t.jpg')
  })
  it('a formátum-sorrendben az mp4 van elöl (iPhone-on is lejátszható)', () => { expect(VIDEO_MIME_CANDIDATES[0].startsWith('video/mp4')).toBe(true) })
  it('óra-formátum', () => { expect(fmtClock(7)).toBe('0:07'); expect(fmtClock(60)).toBe('1:00') })
})
