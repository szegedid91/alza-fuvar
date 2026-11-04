import { describe, it, expect, vi } from 'vitest'
import { computeConsumption, previousFuelForCar, hasLaterOrEqualKm } from './fuel'

// Supabase-kliens helyettesítő: minden lánc végén a beállított választ adja
const response = { data: null as unknown, error: null as unknown, count: null as number | null }
vi.mock('./supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'select', 'eq', 'lt', 'gte', 'not', 'order']) chain[m] = () => chain
  chain.limit = () => Promise.resolve(response)
  chain.then = (res: (v: unknown) => void) => Promise.resolve(response).then(res)
  return { supabase: chain }
})

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

describe('tankolás-lekérdezések — a szerverhiba nem nyelődik el (LOG-04)', () => {
  it('previousFuelForCar hibánál dob, nem „nincs előző”', async () => {
    response.data = null; response.error = { message: 'statement timeout' }
    await expect(previousFuelForCar('car', 1000)).rejects.toMatchObject({ message: 'statement timeout' })
    response.error = null; response.data = [{ odometer_km: 900 }]
    await expect(previousFuelForCar('car', 1000)).resolves.toMatchObject({ odometer_km: 900 })
  })
  it('hasLaterOrEqualKm hibánál dob, nem „false”', async () => {
    response.error = { message: 'RLS' }; response.count = null
    await expect(hasLaterOrEqualKm('car', 1000)).rejects.toMatchObject({ message: 'RLS' })
    response.error = null; response.count = 2
    await expect(hasLaterOrEqualKm('car', 1000)).resolves.toBe(true)
  })
})
