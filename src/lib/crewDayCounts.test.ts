import { describe, expect, it } from 'vitest'
import { crewDayCounts } from './crewDayCounts'

describe('crewDayCounts', () => {
  const members = [
    { id: 'a', role: 'crew', full_name: 'Anna', email: null }, { id: 'b', role: 'crew', full_name: 'Béla', email: null },
    { id: 'm', role: 'manager', full_name: 'Manó', email: null }, { id: 'z', role: 'crew', full_name: null, email: 'z@x.hu' },
  ]
  const isBox = (c: string) => c === 'box'
  it('összes, Box, XL és betanuló napok; egy nap mindkét típusba számít, az összesben egyszer', () => {
    const r = crewDayCounts([
      { work_date: '2026-11-10', car_id: 'box', driver_id: 'a', loader_id: 'b', trainee_id: null },
      { work_date: '2026-11-10', car_id: 'xl', driver_id: 'a', loader_id: null, trainee_id: null },
      { work_date: '2026-11-11', car_id: 'box', driver_id: 'b', loader_id: null, trainee_id: 'a' },
      { work_date: '2026-11-12', car_id: 'xl', driver_id: 'm', loader_id: null, trainee_id: null },
    ], members, isBox)
    expect(r.map((x) => [x.name, x.count, x.box, x.xl, x.trainee])).toEqual([
      ['Anna', 2, 2, 1, 1], ['Béla', 2, 2, 0, 0], ['Manó', 1, 0, 1, 0], ['z@x.hu', 0, 0, 0, 0],
    ])
  })
  it('a vezető csak beosztva látszik', () => {
    expect(crewDayCounts([], members, isBox).map((x) => x.name)).toEqual(['Anna', 'Béla', 'z@x.hu'])
  })
})
