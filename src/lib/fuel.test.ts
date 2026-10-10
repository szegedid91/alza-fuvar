import { describe, it, expect } from 'vitest'
import { computeConsumption } from './fuel'

describe('computeConsumption — l/100 km', () => {
  it('liter / megtett km × 100, két tizedesre', () => {
    expect(computeConsumption(45, 100500, 100000)).toBe(9)
    expect(computeConsumption(33.3, 1300, 1000)).toBe(11.1)
  })
  it('nulla vagy negatív táv → null (hibás km-óra)', () => {
    expect(computeConsumption(40, 1000, 1000)).toBeNull()
    expect(computeConsumption(40, 900, 1000)).toBeNull()
  })
})
