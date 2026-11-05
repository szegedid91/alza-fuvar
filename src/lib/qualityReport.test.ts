import { describe, expect, it } from 'vitest'
import { addDays, buildQualityReport, huDate, qualityFilename, qualitySheet, timeFraction, userSlots, type QEvent, type QRoute, type QSheet, type QShift, type QStop } from './qualityReport'

const routes: QRoute[] = [
  { id: 'rG', code: 'G', active: true, is_relief: false },
  { id: 'rI', code: 'I', active: true, is_relief: false },
  { id: 'rR', code: 'R', active: true, is_relief: false },
  { id: 'rX', code: 'X', active: true, is_relief: true },
]
// helyi idő → ISO (a jelzések UTC-ben tárolódnak)
const at = (d: string, hm: string) => new Date(`${d}T${hm}:00`).toISOString()
const ev = (user_id: string, kind: string, d: string, hm: string, note: string | null = null): QEvent => ({ user_id, kind, at: at(d, hm), note })
const sheet = (id: string, user_id: string, d: string, hm: string, extra: Partial<QSheet> = {}): QSheet => ({
  id, user_id, created_at: at(d, hm), end_time: null, comp_bu: 0, comp_szh: 0, comp_hb: 0, comp_r: 0, comp_note: null,
  wh_crates_no_label: 0, wh_packages_no_label: 0, wh_pallet_items: 0, wh_note: null, ...extra,
})
const stop = (sheet_id: string, d: string, hm: string, extra: Partial<QStop> = {}): QStop => ({
  sheet_id, done_at: at(d, hm), created_at: at(d, hm), box_code: 'AB1', box_name: null, note: null,
  missorted: 0, nf: 0, oversize: 0, shortage: 0, returned: 0, damaged: 0, left_on_car: 0, ...extra,
})
const shift = (work_date: string, round: number, route_id: string | null, driver_id: string | null, loader_id: string | null = null): QShift => ({ work_date, round, route_id, driver_id, loader_id })

const DAY = '2026-10-26'
const EVE = '2026-10-25'

describe('segédek', () => {
  it('dátumok és idő', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(huDate('2026-10-25')).toBe('2026.10.25.')
    expect(timeFraction('05:30')).toBeCloseTo(0.2291666, 6)
    expect(timeFraction('23:59')).toBeCloseTo(0.9993055, 6)
  })
  it('fájlnév a cég nevével, tiltott karakterek nélkül', () => {
    expect(qualityFilename('Utód zrt.', DAY)).toBe('Utód zrt. riport 2026-10-26.xlsx')
    expect(qualityFilename(' A/B: C ', DAY)).toBe('A B C riport 2026-10-26.xlsx')
    expect(qualityFilename('', DAY)).toBe('riport 2026-10-26.xlsx')
  })
})

describe('userSlots', () => {
  it('egy kör ablaka: indulás előtt 6, utána 18 óra', () => {
    const s = userSlots([shift(EVE, 1, 'rG', 'u1')]).get('u1')!
    expect(s).toHaveLength(1)
    expect(new Date(s[0].lo).getHours()).toBe(17)
    expect(s[0].hi - s[0].start).toBe(18 * 3600_000)
  })
  it('éjszakai után nappali kör: a határ a nappali indulás előtt van, nem éjfélkor', () => {
    const s = userSlots([shift(EVE, 1, 'rG', 'u1'), shift(DAY, 2, 'rG', 'u1')]).get('u1')!
    expect(s[0].hi).toBe(s[1].lo)
    const boundary = new Date(s[0].hi)
    expect(boundary.getDate()).toBe(26)
    expect(boundary.getHours()).toBe(4) // 5:30 előtt 45 perccel
  })
})

describe('buildQualityReport', () => {
  it('az éjszakai blokk az előző esti 1. kör, a nappali a napi 2. kör — a mintával egyező címekkel', () => {
    const r = buildQualityReport(DAY, routes, [], [], [], [], 'Budapest')
    expect(r.night.title).toBe('2026.10.25. Minőség jelentés - éjszakai járat')
    expect(r.dayBlock.title).toBe('2026.10.26. Minőség jelentés - nappali járat')
    expect(r.night.rows.map((x) => x.label)).toEqual(['Budapest G', 'Budapest I', 'Budapest R'])
    expect(r.night.rows[0]).toMatchObject({ planned: '23:59', staffed: false, departed: null, ended: null, missorted: null, complications: '', note: '' })
    expect(r.dayBlock.rows[0].planned).toBe('05:30')
  })

  it('az éjfél utáni jelzések és megállók az éjszakai járathoz tartoznak', () => {
    const shifts = [shift(EVE, 1, 'rG', 'u1')]
    const events = [
      ev('u1', 'arrived', EVE, '22:40'),
      ev('u1', 'departed', DAY, '00:07'),
      ev('u1', 'issue', DAY, '02:15', 'AB1234 nem működik'),
      ev('u1', 'done', DAY, '04:50'),
      ev('u1', 'settled', DAY, '05:20'),
    ]
    const sheets = [sheet('s1', 'u1', DAY, '00:30', { comp_bu: 2, comp_note: 'lassú kijelző' })]
    const stops = [
      stop('s1', DAY, '01:00', { missorted: 1, nf: 2, oversize: 1, shortage: 3, returned: 4, damaged: 1, left_on_car: 2, note: 'tele volt' }),
      stop('s1', DAY, '03:00', { missorted: 2, returned: 1 }),
    ]
    const g = buildQualityReport(DAY, routes, shifts, events, sheets, stops, 'Budapest').night.rows[0]
    expect(g).toMatchObject({ staffed: true, departed: '00:07', ended: '04:50', endedFromSheet: false, settled: '05:20', hasSheet: true })
    expect(g).toMatchObject({ missorted: 3, noFit: 3, shortage: 3, returned: 5, undelivered: 3 })
    expect(g.complications).toBe('02:15 AB1234 nem működik\nBox újraindítás: 2\nlassú kijelző')
    expect(g.note).toContain('Elszámolás: 05:20')
    expect(g.note).toContain('nincs szabad fiók 2, túlméretes 1')
    expect(g.note).toContain('autón maradt 2')
    expect(g.note).toContain('AB1: tele volt')
    // a nappali blokkba semmi nem kerül át
    const d = buildQualityReport(DAY, routes, shifts, events, sheets, stops).dayBlock.rows[0]
    expect(d).toMatchObject({ staffed: false, departed: null, hasSheet: false, missorted: null })
  })

  it('aki éjszaka és nappal is megy, annak a jelzései kör szerint válnak szét', () => {
    const shifts = [shift(EVE, 1, 'rG', 'u1'), shift(DAY, 2, 'rI', 'u1')]
    const events = [
      ev('u1', 'departed', EVE, '23:58'), ev('u1', 'done', DAY, '04:10'),
      ev('u1', 'departed', DAY, '05:34'), ev('u1', 'done', DAY, '11:02'), ev('u1', 'settled', DAY, '11:30'),
    ]
    const sheets = [sheet('s1', 'u1', DAY, '00:20')]
    const stops = [stop('s1', DAY, '01:00', { shortage: 1 }), stop('s1', DAY, '08:00', { shortage: 5 })]
    const r = buildQualityReport(DAY, routes, shifts, events, sheets, stops)
    expect(r.night.rows[0]).toMatchObject({ departed: '23:58', ended: '04:10', settled: null, shortage: 1 })
    expect(r.dayBlock.rows[1]).toMatchObject({ label: 'I', departed: '05:34', ended: '11:02', settled: '11:30', shortage: 5 })
  })

  it('Box-lap nélkül a darabszám üres (nem 0); „Járat kész” nélkül a lap végzési ideje számít', () => {
    const shifts = [shift(DAY, 2, 'rR', 'u2', 'u3'), shift(DAY, 2, 'rG', 'u4')]
    const events = [ev('u3', 'departed', DAY, '05:40'), ev('u2', 'departed', DAY, '05:45')]
    const sheets = [sheet('s2', 'u2', DAY, '06:00', { end_time: '12:15:00' })]
    const r = buildQualityReport(DAY, routes, shifts, events, sheets, [])
    const rr = r.dayBlock.rows[2]
    expect(rr).toMatchObject({ departed: '05:45', ended: '12:15', endedFromSheet: true, hasSheet: true, missorted: 0, noFit: 0 }) // a sofőré az irányadó
    expect(r.dayBlock.rows[0]).toMatchObject({ staffed: true, departed: null, hasSheet: false, shortage: null })
  })

  it('a más napi vagy más emberé adat nem kerül bele; a járat nélküli beosztást megszámolja', () => {
    const shifts = [shift(DAY, 2, 'rG', 'u1'), shift(DAY, 2, null, 'u9'), shift('2026-10-27', 2, 'rG', 'u1')]
    const events = [ev('u1', 'departed', '2026-10-27', '05:31'), ev('u7', 'departed', DAY, '05:31')]
    const r = buildQualityReport(DAY, routes, shifts, events, [], [])
    expect(r.dayBlock.rows[0].departed).toBeNull()
    expect(r.dayBlock.unrouted).toBe(1)
    expect(r.night.unrouted).toBe(0)
  })
})

describe('qualitySheet', () => {
  const shifts = [shift(EVE, 1, 'rG', 'u1')]
  const events = [ev('u1', 'departed', DAY, '00:07'), ev('u1', 'done', DAY, '04:50')]
  const sheets = [sheet('s1', 'u1', DAY, '00:30')]
  const stops = [stop('s1', DAY, '01:00', { missorted: 1 })]
  const sh = qualitySheet(buildQualityReport(DAY, routes, shifts, events, sheets, stops, 'Budapest'), 'Utód zrt.')

  it('a minta elrendezése: cím, fejléc, három sor, majd négy üres sor után a nappali blokk', () => {
    expect(sh.cells.A1.v).toBe('Utód zrt.: 2026.10.25. Minőség jelentés - éjszakai járat')
    expect(sh.cells.A10.v).toBe('Utód zrt.: 2026.10.26. Minőség jelentés - nappali járat')
    expect(sh.merges).toEqual(['A1:K1', 'A10:K10'])
    expect(sh.cells.A2.v).toBe('Útvonal')
    expect(sh.cells.K11.v).toBe('Megjegyzés')
    expect([sh.cells.A3.v, sh.cells.A4.v, sh.cells.A5.v]).toEqual(['Budapest G', 'Budapest I', 'Budapest R'])
    expect(sh.cells.A6).toBeUndefined()
  })
  it('az idők Excel-időként, a darabok számként, az ismeretlen üresen', () => {
    expect(sh.cells.B3.v).toBeCloseTo(0.9993055, 6)
    expect(sh.cells.B3.s?.numFmt).toBe('hh:mm')
    expect(sh.cells.C3.v).toBeCloseTo(timeFraction('00:07'), 6)
    expect(sh.cells.D3.v).toBeCloseTo(timeFraction('04:50'), 6)
    expect(sh.cells.F3.v).toBe(1)
    expect(sh.cells.G3.v).toBe(0)
    expect(sh.cells.F4.v).toBeUndefined()
    expect(sh.cells.C4.v).toBeUndefined()
    expect(sh.cells.B12.v).toBeCloseTo(0.2291666, 6)
  })
  it('a minta színei és vastag szegélye', () => {
    expect(sh.cells.B2.s).toMatchObject({ fill: 'FF9900', border: 'medium', bold: true, wrap: true })
    expect(sh.cells.D3.s?.fill).toBe('FFFF00')
    expect(sh.cells.F3.s?.fill).toBe('C9DAF8')
    expect(sh.cells.K3.s?.fill).toBe('CCCCCC')
    expect(sh.cells.A3.s?.fill).toBe('C9DAF8')
    expect(sh.cells.A4.s?.fill).toBe('B6D7A8')
  })
})
