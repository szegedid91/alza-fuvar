import { describe, it, expect } from 'vitest'
import { normalizeDeadline, sortRules, nextNewRule, isDuplicateRule, type AlertScope } from './setoffAlerts'

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
