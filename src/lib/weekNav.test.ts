import { describe, it, expect } from 'vitest'
import { navKey, navTarget, type NavSlot } from './weekNav'

// két autó, 3 nap: az A autó páros (sofőr + rakodó), a B autó Box (csak sofőr), kedden 2. körrel
const slots: NavSlot[] = []
const add = (car: string, day: number, round: number, field: string) => slots.push({ key: navKey(car, day, round, field), car, day, round, field })
for (const d of [0, 1, 2]) { add('A', d, 1, 'driver_id'); add('A', d, 1, 'loader_id') }
add('B', 0, 1, 'driver_id'); add('B', 1, 1, 'driver_id'); add('B', 1, 2, 'driver_id'); add('B', 2, 1, 'driver_id')

describe('navTarget', () => {
  it('Tab: a következő nap ugyanazon mezője, a sor végén a következő autó első napja', () => {
    expect(navTarget(slots, 'A|0|1|loader_id', 'next', 3)).toBe('A|1|1|loader_id')
    expect(navTarget(slots, 'A|2|1|driver_id', 'next', 3)).toBe('B|0|1|driver_id')
    // a B autón nincs rakodó mező: a cella első mezőjére lép
    expect(navTarget(slots, 'A|2|1|loader_id', 'next', 3)).toBe('B|0|1|driver_id')
    expect(navTarget(slots, 'B|2|1|driver_id', 'next', 3)).toBeNull()
  })
  it('Shift+Tab: vissza, a sor elején az előző autó utolsó napja', () => {
    expect(navTarget(slots, 'A|1|1|driver_id', 'prev', 3)).toBe('A|0|1|driver_id')
    expect(navTarget(slots, 'B|0|1|driver_id', 'prev', 3)).toBe('A|2|1|driver_id')
    expect(navTarget(slots, 'A|0|1|driver_id', 'prev', 3)).toBeNull()
  })
  it('a 2. körből oldalra lépve ott, ahol nincs 2. kör, az 1. kör mezőjére jut', () => {
    expect(navTarget(slots, 'B|1|2|driver_id', 'next', 3)).toBe('B|2|1|driver_id')
    expect(navTarget(slots, 'B|0|1|driver_id', 'next', 3)).toBe('B|1|1|driver_id')
  })
  it('Enter: lefelé a napon belül — rakodó, majd a következő autó, a 2. kör is sorra kerül', () => {
    expect(navTarget(slots, 'A|1|1|driver_id', 'down', 3)).toBe('A|1|1|loader_id')
    expect(navTarget(slots, 'A|1|1|loader_id', 'down', 3)).toBe('B|1|1|driver_id')
    expect(navTarget(slots, 'B|1|1|driver_id', 'down', 3)).toBe('B|1|2|driver_id')
    expect(navTarget(slots, 'B|1|2|driver_id', 'down', 3)).toBeNull()
  })
  it('üres cellákat átlép, ismeretlen mezőről nem lép', () => {
    const sparse = slots.filter((s) => !(s.car === 'A' && s.day === 1))
    expect(navTarget(sparse, 'A|0|1|driver_id', 'next', 3)).toBe('A|2|1|driver_id')
    expect(navTarget(slots, 'X|0|1|driver_id', 'next', 3)).toBeNull()
  })
})
