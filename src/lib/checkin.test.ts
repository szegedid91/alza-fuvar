import { describe, it, expect, vi } from 'vitest'
import { traineeScheduled } from './checkin'

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
