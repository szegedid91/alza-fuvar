import { describe, expect, it } from 'vitest'
import { AI_MAX_PHOTOS, MAX_STOP_PHOTOS, aiPhotoPaths, photoLabel } from './stopPhotos'

describe('aiPhotoPaths', () => {
  it('a korábbi képek elöl, a most készültek a végén', () => {
    expect(aiPhotoPaths(['n1', 'n2'], ['s1', 's2'])).toEqual(['s1', 's2', 'n1', 'n2'])
  })
  it('a már feltöltött mostani kép nem megy kétszer', () => {
    expect(aiPhotoPaths(['n1', 'n2'], ['s1', 'n1', 'n2'])).toEqual(['s1', 'n1', 'n2'])
  })
  it('a keret fölött a legfrissebbek maradnak (a most készültek mind)', () => {
    const saved = ['s1', 's2', 's3', 's4', 's5', 's6']
    const fresh = ['n1', 'n2', 'n3', 'n4', 'n5']
    const got = aiPhotoPaths(fresh, saved)
    expect(got).toHaveLength(AI_MAX_PHOTOS)
    expect(got).toEqual(['s4', 's5', 's6', 'n1', 'n2', 'n3', 'n4', 'n5'])
  })
  it('üres bemenetre üres', () => {
    expect(aiPhotoPaths([], [])).toEqual([])
  })
})

describe('fotó-keret', () => {
  it('négynél több fotó készíthető', () => {
    expect(MAX_STOP_PHOTOS).toBeGreaterThan(4)
    expect(AI_MAX_PHOTOS).toBeGreaterThan(4)
  })
  it('feliratok', () => {
    expect(photoLabel(0)).toBe('Kijelző')
    expect(photoLabel(4)).toBe('5. fotó')
  })
})
