import { describe, it, expect, vi } from 'vitest'
import { traineeScheduled, carFitsPlan, filterCarsByPlan, planCategoryError } from './checkin'

// Supabase-kliens helyettesítő: az rpc hívás paramétereit rögzíti, és a beállított választ adja
const rpcCalls: { fn: string; args: unknown }[] = []
const response = { data: null as unknown, error: null as unknown }
vi.mock('./supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => { rpcCalls.push({ fn, args }); return Promise.resolve(response) } },
}))
vi.mock('./names', () => ({ resolveNames: async () => ({}) }))

describe('traineeScheduled — betanuló az autón (LOG-18)', () => {
  it('szerver-oldali RPC-t hív (a munkatárs a társ beosztás-sorát nem látja), nem a shifts táblát', async () => {
    response.data = true; response.error = null
    await expect(traineeScheduled('car-1', '2026-11-05')).resolves.toBe(true)
    expect(rpcCalls[rpcCalls.length - 1]).toEqual({ fn: 'trainee_scheduled', args: { p_car_id: 'car-1', p_date: '2026-11-05' } })
  })
  it('nincs betanuló → false; a hiba nem nyelődik el (LOG-41)', async () => {
    response.data = false
    await expect(traineeScheduled('car-1', '2026-11-05')).resolves.toBe(false)
    response.data = null; response.error = { message: 'timeout' }
    await expect(traineeScheduled('car-1', '2026-11-05')).rejects.toMatchObject({ message: 'timeout' })
  })
})

describe('Box-ra beosztva csak Box-autó, XL-re csak XL', () => {
  const cats = [{ id: 'box', box_sheet: true }, { id: 'xl', box_sheet: false }]
  const cars = [{ id: 'a', category_id: 'box' }, { id: 'b', category_id: 'xl' }, { id: 'c', category_id: null }]
  it('Box-beosztásnál csak a Box-autó illik, a kategória nélküli átmegy', () => {
    expect(carFitsPlan('box', cats, true)).toBe(true)
    expect(carFitsPlan('xl', cats, true)).toBe(false)
    expect(carFitsPlan(null, cats, true)).toBe(true)
    expect(filterCarsByPlan(cars, cats, true).map((c) => c.id)).toEqual(['a', 'c'])
  })
  it('XL-beosztásnál fordítva', () => {
    expect(filterCarsByPlan(cars, cats, false).map((c) => c.id)).toEqual(['b', 'c'])
  })
  it('beosztás nélkül nincs korlát', () => {
    expect(filterCarsByPlan(cars, cats, null)).toHaveLength(3)
    expect(filterCarsByPlan(cars, undefined, true)).toHaveLength(3)
  })
  it('az elutasítás szövege megnevezi a kategóriát', () => {
    expect(planCategoryError('AUHC-191', true)).toContain('Ma Box-autóra vagy beosztva')
    expect(planCategoryError('LOD-483', false)).toContain('Ma XL-autóra vagy beosztva')
  })
})
