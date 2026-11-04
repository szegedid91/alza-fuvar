import { describe, it, expect } from 'vitest'
import { batchStartFromRows } from './boxImport'

describe('batchStartFromRows — inaktiválási határ a szerver időbélyegeiből (LOG-11)', () => {
  it('a legkisebb updated_at (ISO, lexikografikusan rendezhető)', () => {
    expect(batchStartFromRows([
      { updated_at: '2026-11-04T05:00:02.000Z' }, { updated_at: '2026-11-04T05:00:01.500Z' }, { updated_at: null },
    ])).toBe('2026-11-04T05:00:01.500Z')
  })
  it('nincs időbélyeg → null (nem inaktiválunk vakon)', () => {
    expect(batchStartFromRows([])).toBeNull()
    expect(batchStartFromRows([{ updated_at: null }])).toBeNull()
  })
})
