import { describe, it, expect } from 'vitest'
import { normalizeDeadline, sortRules, nextNewRule, isDuplicateRule, activeAlarms, alarmPeople, callProblem, type AlertScope } from './setoffAlerts'

describe('„nem indult el” riasztás — szabály-segédek', () => {
  it('határidő egységes alakja (az adatbázis másodperccel adja vissza)', () => {
    expect(normalizeDeadline('05:00:00')).toBe('05:00')
    expect(normalizeDeadline('5:0')).toBe('05:00')
    expect(normalizeDeadline('23:59')).toBe('23:59')
    expect(normalizeDeadline('24:00')).toBeNull()
    expect(normalizeDeadline('')).toBeNull()
    expect(normalizeDeadline(null)).toBeNull()
  })
  it('rendezés: határidő, azon belül kör szerint', () => {
    const rules: { deadline: string; scope: AlertScope }[] = [
      { deadline: '23:30:00', scope: 'box1' }, { deadline: '05:00:00', scope: 'box2' }, { deadline: '05:00', scope: 'all' },
    ]
    expect(sortRules(rules).map((r) => `${normalizeDeadline(r.deadline)} ${r.scope}`)).toEqual(['05:00 all', '05:00 box2', '23:30 box1'])
  })
  it('új szabály: az első még nem használt (határidő, kör) pár', () => {
    expect(nextNewRule([])).toEqual({ deadline: '05:00', scope: 'all' })
    expect(nextNewRule([{ deadline: '05:00:00', scope: 'all' }])).toEqual({ deadline: '05:00', scope: 'xl' })
  })
  it('azonos határidő + kör kétszer nem vehető fel (a saját sorát nem számolja)', () => {
    const rules = [{ id: 'a', deadline: '05:00:00', scope: 'all' as AlertScope }, { id: 'b', deadline: '23:30:00', scope: 'box1' as AlertScope }]
    expect(isDuplicateRule(rules, 'b', '05:00', 'all')).toBe(true)
    expect(isDuplicateRule(rules, 'a', '05:00', 'all')).toBe(false)
    expect(isDuplicateRule(rules, null, '05:00', 'xl')).toBe(false)
  })
})

describe('futó riasztás — mit mutat a riasztó-képernyő', () => {
  const now = new Date('2026-11-06T05:10:00Z').getTime()
  const alarm = (over: Record<string, unknown>) => ({ id: 'a', fired_at: '2026-11-06T05:00:00Z', deadline: '05:00:00', ended_reason: null, missing: [], ...over })
  it('a magától megoldódott és a 3 óránál régebbi riasztás nem jelenik meg; a lejárt (senki nem nyitotta meg) igen', () => {
    const rows = [alarm({ id: '1' }), alarm({ id: '2', ended_reason: 'resolved' }), alarm({ id: '3', ended_reason: 'expired' }), alarm({ id: '4', fired_at: '2026-11-06T01:00:00Z' })]
    expect(activeAlarms(rows, now).map((a) => a.id)).toEqual(['1', '3'])
  })
  it('a hiányzók egyszer szerepelnek, névsorban; a hibás elemeket kihagyja', () => {
    const people = alarmPeople([
      alarm({ missing: [{ id: 'u2', name: 'Nagy Gábor', plate: 'AUFS-312', route: 'G', round: 1 }, { id: 'u1', name: 'Császár Dávid', plate: 'LOD-483' }] }),
      alarm({ missing: [{ id: 'u2', name: 'Nagy Gábor' }, null, { name: 'azonosító nélkül' }] }),
      alarm({ missing: 'nem lista' }),
    ])
    expect(people.map((p) => p.name)).toEqual(['Császár Dávid', 'Nagy Gábor'])
    expect(people[1]).toMatchObject({ plate: 'AUFS-312', route: 'G', round: 1 })
    expect(people[0]).toMatchObject({ route: null, round: null })
  })
})

describe('telefonhívás állapota a beállító kártyán', () => {
  it('nincs bekötve → jelzi; nincs hívható szám → jelzi; minden rendben → nincs teendő', () => {
    expect(callProblem({ configured: false, phone: '+36 30 ••• 4567' })).toMatch(/nincs bekötve/)
    expect(callProblem({ configured: true, phone: null })).toMatch(/nincs hívható magyar mobilszám/)
    expect(callProblem({ configured: true, phone: '+36 30 ••• 4567' })).toBeNull()
    expect(callProblem(null)).toBeNull()
  })
})
