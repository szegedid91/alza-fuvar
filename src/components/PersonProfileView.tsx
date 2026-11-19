import { useState, type ReactNode } from 'react'
import Icon, { type IconName } from './Icon'
import { ChartCard, ColumnChart, LineChart, RankedBars, StatTile } from './charts/Charts'
import { compactHuf, dayShort, monthShort } from '../lib/chartUtils'
import { formatDate, formatHuf, roleLabel, statusLabel } from '../lib/labels'
import { monthTitle } from '../lib/calendar'
import type { Departure, MonthRow, Tempo } from '../lib/personStats'
import type { CompareRow } from '../lib/teamStats'
import type { AdvanceBasis } from '../lib/payroll'
import type { Enums } from '../lib/database.types'

export interface PersonData {
  person: { id: string; name: string; email: string | null; phone: string | null; role: Enums<'user_role'>; status: Enums<'user_status'>; workspace: string | null; createdAt: string | null }
  showPay: boolean
  basis: AdvanceBasis
  months: MonthRow[]
  hours: { ym: string; avg: number | null; days: number }[]
  cars: { plate: string; days: number }[]
  xl: { date: string; count: number; plate: string }[]
  xlBonus: { over: number; amount: number } | null
  attendance: { assigned: number; worked: number; missed: string[]; excused?: number }
  counts: { outside: number; switches: number; swaps: number; inspections: number; lateStops: number; avgLate: number | null }
  adjustments: { date: string; type: string; amount: number; reason: string | null }[]
  rateChanges: { from: string; driver: number; loader: number; box: number; box2: number; bonusOver: number; bonus: number }[]
  fuel: { date: string; plate: string; liters: number | null; amount: number | null; consumption: number | null; location: string | null }[]
  incidents: { date: string; plate: string; note: string | null }[]
  issues: { date: string; plate: string; note: string | null; status: string }[]
  cleanings: { date: string; plate: string }[]
  box: { sheets: number; stops: number; placed: number; problems: { label: string; value: number }[] }
  // az előlegek az időszaktól függetlenül, minden hónapra visszamenőleg
  advancesAll: { months: { ym: string; amount: number; count: number }[]; items: { date: string; amount: number; reason: string | null }[]; total: number }
  punctuality: { departures: Departure[]; alarms: number; calls: number }
  tempo: Tempo
  quality: { stops: number; problemTotal: number; per100: number | null; noPhotoStops: number; boxIssues: number }
  discipline: { manual: number; waived: number; notParked: number; cleanings: number; workedDays: number }
  efficiency: { perXlAddress: number | null; perBoxStop: number | null; fuelAvg: number | null; damage: number }
  // az ugyanilyen hosszú előző időszak fő számai (null = nincs mihez mérni)
  prev: { days: number; base: number; missed: number | null; lateDepartures: number; lateStops: number } | null
  // a csapathoz mérve (null = még töltődik; üres = nincs kihez mérni)
  team: CompareRow[] | null
}

const MONTH_FROM = ['januártól', 'februártól', 'márciustól', 'áprilistól', 'májustól', 'júniustól', 'júliustól', 'augusztustól', 'szeptembertől', 'októbertől', 'novembertől', 'decembertől']
const hoursText = (h: number) => `${h.toLocaleString('hu-HU', { maximumFractionDigits: 1 })} ó`
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)
const LATE_MIN = 5 // ennyi percnél nagyobb csúszás számít késett indulásnak
// Változás az előző, ugyanilyen hosszú időszakhoz képest — szövegként, szín nélkül (a szám előjele beszél)
const vsPrev = (now: number, prev: number | null | undefined, unit = ''): string | undefined => {
  if (prev == null) return undefined
  const d = now - prev
  if (d === 0) return prev === 0 ? undefined : 'előző időszak: ugyanennyi'
  return `előző időszak: ${prev.toLocaleString('hu-HU')}${unit} (${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString('hu-HU')})`
}

// Egy mutató a csapathoz mérve: a sáv az ember értéke, a függőleges jel a csapatátlag (közös skálán), mellette a helyezés.
// A sáv színe nem minősít — hogy jobb-e az átlagnál, azt a szöveg mondja meg.
const num = (v: number, unit: string) => `${v.toLocaleString('hu-HU', { maximumFractionDigits: unit === 'nap' || unit === 'db' ? (Number.isInteger(v) ? 0 : 1) : 1 })}${unit === '%' ? '%' : ` ${unit}`}`
function TeamRow({ r }: { r: CompareRow }) {
  const max = Math.max(r.mine, r.avg, 0.0001) * 1.12
  const diff = r.mine - r.avg
  const same = Math.abs(diff) < Math.max(0.05, Math.abs(r.avg) * 0.03)
  const better = same ? null : r.lowerIsBetter ? diff < 0 : diff > 0
  return (
    <div className="viz-team-row">
      <div className="between small" style={{ gap: 8, alignItems: 'baseline' }}>
        <span style={{ fontWeight: 600 }}>{r.label}</span>
        <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{r.rank}. a {r.of}-ból</span>
      </div>
      <div className="viz-team-track" role="img" aria-label={`${r.label}: ${num(r.mine, r.unit)}, csapatátlag ${num(r.avg, r.unit)}`}>
        <span className="viz-team-bar" style={{ width: `${Math.max(1.5, (r.mine / max) * 100)}%` }} />
        <span className="viz-team-avg" style={{ left: `${(r.avg / max) * 100}%` }} />
      </div>
      <div className="tiny" style={{ color: 'var(--text-dim)' }}>
        <strong style={{ color: 'var(--text)' }}>{num(r.mine, r.unit)}</strong> · csapatátlag {num(r.avg, r.unit)}
        {better != null && <> · {better ? 'jobb az átlagnál' : 'gyengébb az átlagnál'}</>}{same && <> · az átlag körül</>}
      </div>
    </div>
  )
}

// Szakasz: cím darabszámmal; a hosszú lista az első néhány sorral indul, a többi egy koppintásra
function Section({ icon, title, count, empty, children }: { icon: IconName; title: string; count?: number; empty?: string; children?: ReactNode }) {
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}><Icon name={icon} />{title}</div>
        {count != null && <span className={`badge ${count > 0 ? 'primary' : ''}`}>{count}</span>}
      </div>
      {count === 0 && empty ? <div className="tiny muted">{empty}</div> : children}
    </div>
  )
}
function Rows<T>({ items, render, first = 6 }: { items: T[]; render: (x: T, i: number) => ReactNode; first?: number }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, first)
  return (
    <div className="stack" style={{ gap: 0 }}>
      {shown.map((x, i) => <div key={i} className="between small" style={{ gap: 10, padding: '5px 0', borderTop: i ? '1px solid var(--border)' : 'none', alignItems: 'flex-start' }}>{render(x, i)}</div>)}
      {items.length > first && <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setAll((v) => !v)}>{all ? 'Kevesebb' : `Mind (${items.length})`}</button>}
    </div>
  )
}

// Egy munkatárs teljes adatlapja a kiválasztott időszakra (a számítás a hívónál van — ez csak megjelenít)
export default function PersonProfileView({ data }: { data: PersonData }) {
  const { months, showPay } = data
  const cats = months.map((r) => monthShort(r.ym))
  const titles = months.map((r) => monthTitle(r.ym))
  const days = sum(months.map((r) => r.days))
  const base = sum(months.map((r) => r.base))
  const advances = sum(months.map((r) => r.advances))
  const deductions = sum(months.map((r) => r.deductions))
  const withHours = data.hours.filter((h) => h.avg != null) as { ym: string; avg: number; days: number }[]
  const hourDays = sum(withHours.map((h) => h.days))
  const avgHours = hourDays ? sum(withHours.map((h) => h.avg * h.days)) / hourDays : null
  const fuelCost = sum(data.fuel.map((f) => f.amount ?? 0))
  const xlAvg = data.xl.length ? sum(data.xl.map((x) => x.count)) / data.xl.length : null
  const anyPay = months.some((r) => r.base > 0)
  const anyDays = months.some((r) => r.days > 0)
  const dayWord = data.basis === 'schedule' ? 'Beosztott nap' : 'Ledolgozott nap'
  const p = data.person
  const deps = data.punctuality.departures
  const lateDeps = deps.filter((d) => d.lateMin > LATE_MIN)
  const depMonths = months.map((r) => { const v = deps.filter((d) => d.date.startsWith(r.ym)); const late = v.filter((d) => d.lateMin > LATE_MIN).length; return { ym: r.ym, late, onTime: v.length - late } })
  const runs = data.tempo.runs.filter((r) => r.minutes > 0)
  const avgRun = runs.length ? sum(runs.map((r) => r.minutes)) / runs.length : null
  const adv = data.advancesAll
  const advChart = adv.months.slice(-18)
  // aki még nem regisztrált (vagy az időszakban egyszer sem csekkolt be), annál a „kimaradt nap” nem mond semmit
  const noCheckins = data.attendance.worked === 0

  return (
    <div className="stack">
      <div className="card stack" style={{ gap: 6 }}>
        <div className="between" style={{ alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 800, overflowWrap: 'anywhere' }}>{p.name}</div>
            <div className="tiny muted">{[p.workspace, p.email].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span className={`badge ${p.role === 'admin' ? 'warning' : p.role === 'manager' ? 'primary' : ''}`}>{roleLabel[p.role]}</span>
            <span className={`badge ${p.status === 'active' ? 'success' : p.status === 'invited' ? 'warning' : 'danger'}`}>{p.status === 'active' ? 'regisztrált' : p.status === 'invited' ? 'még nem regisztrált' : statusLabel[p.status]}</span>
          </div>
        </div>
        <div className="tiny muted row" style={{ gap: 12, flexWrap: 'wrap' }}>
          {p.phone && <a href={`tel:${p.phone.replace(/\s/g, '')}`} className="row" style={{ gap: 4, textDecoration: 'none' }}><Icon name="phone" size={14} />{p.phone}</a>}
          {p.createdAt && <span>Felvéve: {formatDate(p.createdAt)}</span>}
        </div>
      </div>

      <div className="viz-stats">
        <StatTile label={dayWord} value={String(days)} sub={vsPrev(days, data.prev?.days) ?? `${months.length} hónap alatt`} />
        {showPay && <StatTile label="Bér összesen" value={formatHuf(base)} sub={data.prev ? `előző időszak: ${formatHuf(data.prev.base)}` : deductions > 0 ? `levonás: ${formatHuf(deductions)}` : 'levonás nélkül'} />}
        {showPay && <StatTile label="Felvett előleg" value={formatHuf(advances)} />}
        <StatTile label="Átlagos munkaidő" value={avgHours != null ? hoursText(avgHours) : '–'} sub={avgHours != null ? `${hourDays} lezárt nap alapján` : 'nincs lezárt nap'} />
        <StatTile label="Kimaradt nap" value={noCheckins ? '–' : String(data.attendance.missed.length)} sub={noCheckins ? 'nincs becsekkolás az időszakban' : vsPrev(data.attendance.missed.length, data.prev?.missed) ?? `${data.attendance.assigned} beosztottból`} />
        {deps.length > 0 && <StatTile label="Késve indult" value={`${lateDeps.length} / ${deps.length}`} sub={vsPrev(lateDeps.length, data.prev?.lateDepartures) ?? `${LATE_MIN} percnél nagyobb csúszás`} />}
        {data.tempo.stops > 0 && <StatTile label="Késett megálló" value={`${Math.round((data.tempo.lateStops / data.tempo.stops) * 100)}%`} sub={vsPrev(data.tempo.lateStops, data.prev?.lateStops, ' db') ?? `${data.tempo.lateStops} a ${data.tempo.stops}-ból`} />}
        {data.xl.length > 0 && <StatTile label="XL átlag cím / nap" value={xlAvg!.toLocaleString('hu-HU', { maximumFractionDigits: 1 })} sub={`${data.xl.length} nap adata`} />}
        {data.box.stops > 0 && <StatTile label="Box megálló" value={String(data.box.stops)} sub={`${data.box.placed.toLocaleString('hu-HU')} behelyezett csomag`} />}
      </div>

      <div className="viz-grid-2">
        {showPay && anyPay && (
          <ChartCard title="Bér havonta" subtitle={`Alapbér ${data.basis === 'schedule' ? 'a beosztás' : 'a becsekkolás'} szerint, levonás és előleg nélkül`}
            legend={[{ label: 'XL', color: 'var(--viz-1)' }, { label: 'AlzaBox', color: 'var(--viz-2)' }, { label: 'XL sikerdíj', color: 'var(--viz-3)' }]}
            table={{ head: ['Hónap', 'XL', 'AlzaBox', 'Sikerdíj', 'Alapbér', 'Levonás', 'Előleg', 'Fizetendő'],
              rows: months.map((r) => [monthTitle(r.ym), formatHuf(r.xlPay), formatHuf(r.boxPay), formatHuf(r.bonusPay), formatHuf(r.base), formatHuf(r.deductions), formatHuf(r.advances), formatHuf(r.payout)]) }}>
            <ColumnChart categories={cats} titles={titles} format={formatHuf} axisFormat={compactHuf}
              series={[
                { key: 'xl', label: 'XL', color: 'var(--viz-1)', values: months.map((r) => r.xlPay) },
                { key: 'box', label: 'AlzaBox', color: 'var(--viz-2)', values: months.map((r) => r.boxPay) },
                { key: 'bonus', label: 'XL sikerdíj', color: 'var(--viz-3)', values: months.map((r) => r.bonusPay) },
              ]} />
          </ChartCard>
        )}
        {anyDays && (
          <ChartCard title={`${dayWord}ok havonta`} subtitle="XL és AlzaBox napok (egy nap mindkettő lehet)"
            legend={[{ label: 'XL', color: 'var(--viz-1)' }, { label: 'AlzaBox', color: 'var(--viz-2)' }]}
            table={{ head: ['Hónap', 'XL nap', 'Box nap', 'Betanuló', 'Összes', 'Még hátra'], rows: months.map((r) => [monthTitle(r.ym), r.xlDays, r.boxDays, r.traineeDays, r.days, r.futureDays]) }}>
            <ColumnChart categories={cats} titles={titles} format={(n) => `${n} nap`} axisFormat={(n) => String(n)}
              series={[
                { key: 'xl', label: 'XL', color: 'var(--viz-1)', values: months.map((r) => r.xlDays) },
                { key: 'box', label: 'AlzaBox', color: 'var(--viz-2)', values: months.map((r) => r.boxDays) },
              ]} />
          </ChartCard>
        )}
        {withHours.length >= 2 && (
          <ChartCard title="Átlagos napi munkaidő" subtitle="Az első becsekkolástól az autó lerakásáig, havi átlag"
            table={{ head: ['Hónap', 'Átlag', 'Nap'], rows: withHours.map((h) => [monthTitle(h.ym), hoursText(h.avg), h.days]) }}>
            <LineChart color="var(--viz-1)" format={hoursText} axisFormat={(n) => `${n} ó`} points={withHours.map((h) => ({ label: monthShort(h.ym), value: h.avg }))} titles={withHours.map((h) => monthTitle(h.ym))} />
          </ChartCard>
        )}
        {data.xl.length >= 2 && (
          <ChartCard title="XL sikeres címek naponta" subtitle={data.xlBonus && data.xlBonus.amount > 0 ? `Sikerdíj ${data.xlBonus.over} cím felett: ${formatHuf(data.xlBonus.amount)}` : 'Sofőrként vagy rakodóként vitt napok'}
            table={{ head: ['Nap', 'Autó', 'Cím'], rows: data.xl.map((x) => [formatDate(x.date), x.plate, x.count]) }}>
            <LineChart color="var(--viz-1)" format={(n) => `${n} cím`} axisFormat={(n) => String(n)} points={data.xl.map((x) => ({ label: dayShort(x.date), value: x.count }))}
              titles={data.xl.map((x) => `${formatDate(x.date)} · ${x.plate}`)} refLine={data.xlBonus && data.xlBonus.amount > 0 ? { value: data.xlBonus.over, label: `sikerdíj ${data.xlBonus.over} felett` } : undefined} />
          </ChartCard>
        )}
        {deps.length > 0 && (
          <ChartCard title="Indulások pontossága havonta" subtitle={`A „Kiindultam” jelzés a járat tervezett indulásához képest (${LATE_MIN} perc türelemmel)`}
            legend={[{ label: 'Pontos', color: 'var(--viz-1)' }, { label: 'Késett', color: 'var(--viz-2)' }]}
            table={{ head: ['Nap', 'Járat', 'Kör', 'Terv', 'Tény', 'Eltérés'], rows: [...deps].reverse().map((d) => [formatDate(d.date), d.route ?? '–', `${d.round}.`, d.planned, d.actual, `${d.lateMin > 0 ? '+' : ''}${d.lateMin} perc`]) }}>
            <ColumnChart categories={cats} titles={titles} format={(n) => `${n} indulás`} axisFormat={(n) => String(n)}
              series={[
                { key: 'ok', label: 'Pontos', color: 'var(--viz-1)', values: depMonths.map((m) => m.onTime) },
                { key: 'late', label: 'Késett', color: 'var(--viz-2)', values: depMonths.map((m) => m.late) },
              ]} />
          </ChartCard>
        )}
        {data.tempo.reasons.length > 0 && (
          <ChartCard title="Késések okai" subtitle="A késett box-megállóknál megadott ok"
            table={{ head: ['Ok', 'Megálló'], rows: data.tempo.reasons.map((r) => [r.label, r.value]) }}>
            <RankedBars color="var(--viz-1)" format={(n) => `${n} db`} rows={data.tempo.reasons.slice(0, 8)} />
          </ChartCard>
        )}
        {showPay && advChart.some((m) => m.amount > 0) && (
          <ChartCard title="Felvett előleg havonta" subtitle={`Minden hónapra visszamenőleg${adv.months.length > advChart.length ? ' (a diagramon az utolsó 18 hónap)' : ''} · összesen ${formatHuf(adv.total)}`}
            table={{ head: ['Hónap', 'Előleg', 'Alkalom'], rows: [...adv.months].reverse().map((m) => [monthTitle(m.ym), formatHuf(m.amount), m.count]) }}>
            <ColumnChart categories={advChart.map((m) => monthShort(m.ym))} titles={advChart.map((m) => monthTitle(m.ym))} format={formatHuf} axisFormat={compactHuf}
              series={[{ key: 'adv', label: 'Előleg', color: 'var(--viz-1)', values: advChart.map((m) => m.amount) }]} />
          </ChartCard>
        )}
        {data.cars.length > 0 && (
          <ChartCard title="Melyik autón hány napot" subtitle="A beosztás szerint, a mai napig"
            table={{ head: ['Autó', 'Nap'], rows: data.cars.map((c) => [c.plate, c.days]) }}>
            <RankedBars color="var(--viz-1)" format={(n) => `${n} nap`} rows={data.cars.slice(0, 8).map((c) => ({ label: c.plate, value: c.days }))} />
          </ChartCard>
        )}
      </div>

      {data.team && data.team.length > 0 && (
        <div className="card stack" style={{ gap: 10 }}>
          <div>
            <div className="card-title" style={{ margin: 0 }}><Icon name="users" />A csapathoz mérve</div>
            <div className="tiny muted">Ugyanarra az időszakra, a munkaterület minden emberével. A sáv az ő értéke, a függőleges vonal a csapatátlag. Egy mutatóba csak az számít bele, akinél van hozzá elég adat.</div>
          </div>
          <div className="viz-team">{data.team.map((r) => <TeamRow key={r.key} r={r} />)}</div>
        </div>
      )}

      {showPay && (
        <Section icon="banknote" title="Fizetések havonta" count={months.filter((r) => r.base > 0 || r.advances > 0 || r.deductions > 0).length} empty="Az időszakban nincs elszámolható nap, előleg vagy levonás.">
          <div style={{ overflowX: 'auto' }}>
            <table className="viz-table">
              <thead><tr><th>Hónap</th><th>Nap</th><th>Alapbér</th><th>Levonás</th><th>Előleg</th><th>Fizetendő</th></tr></thead>
              <tbody>
                {[...months].reverse().filter((r) => r.base > 0 || r.advances > 0 || r.deductions > 0).map((r) => (
                  <tr key={r.ym}><td>{monthTitle(r.ym)}</td><td>{r.days}</td><td>{formatHuf(r.base)}</td><td>{r.deductions ? `−${formatHuf(r.deductions)}` : '–'}</td><td>{r.advances ? `−${formatHuf(r.advances)}` : '–'}</td><td><strong>{formatHuf(r.payout)}</strong></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {showPay && (
        <Section icon="banknote" title="Előlegek — mikor mennyit vett fel" count={adv.items.length} empty="Még nem vett fel előleget.">
          <div className="tiny muted">Minden hónapra visszamenőleg, a választott időszaktól függetlenül · összesen {formatHuf(adv.total)}</div>
          <Rows items={adv.items} first={8} render={(a) => (<>
            <span><strong>{formatDate(a.date)}</strong>{a.reason ? <span className="muted"> · {a.reason}</span> : null}</span>
            <span className="num" style={{ whiteSpace: 'nowrap' }}>{formatHuf(a.amount)}</span>
          </>)} />
        </Section>
      )}
      {showPay && (
        <Section icon="wallet" title="Előlegek és levonások az időszakban" count={data.adjustments.length} empty="Az időszakban nem volt előleg vagy levonás.">
          <Rows items={data.adjustments} render={(a) => (<>
            <span><strong>{a.type === 'advance' ? 'Előleg' : 'Levonás'}</strong> <span className="muted">· {formatDate(a.date)}{a.reason ? ` · ${a.reason}` : ''}</span></span>
            <span className="num" style={{ whiteSpace: 'nowrap' }}>−{formatHuf(a.amount)}</span>
          </>)} />
        </Section>
      )}
      {showPay && (
        <Section icon="trending-up" title="Bérváltozások" count={data.rateChanges.length} empty="Nincs rögzített napidíj-változás.">
          <Rows items={data.rateChanges} render={(r, i) => {
            const prev = data.rateChanges[i + 1]
            const pct = prev && prev.driver > 0 && prev.driver !== r.driver ? Math.round(((r.driver - prev.driver) / prev.driver) * 1000) / 10 : null
            return (<>
              <span><strong>{r.from === '2000-01-01' ? 'Kezdeti díj' : `${r.from.slice(0, 4)}. ${MONTH_FROM[Number(r.from.slice(5, 7)) - 1]}`}</strong>
                <span className="muted"> · XL sofőr {formatHuf(r.driver)}{pct != null ? ` (${pct > 0 ? '+' : ''}${pct.toLocaleString('hu-HU')}%)` : ''} · rakodó {formatHuf(r.loader)}{r.box > 0 ? ` · Box ${formatHuf(r.box)}${r.box2 > 0 ? ` +${formatHuf(r.box2)}` : ''}` : ''}{r.bonus > 0 ? ` · sikerdíj ${r.bonusOver} cím felett ${formatHuf(r.bonus)}` : ''}</span></span>
            </>)
          }} />
        </Section>
      )}

      <Section icon="clock" title="Pontosság" count={deps.length} empty="Az időszakban nincs „Kiindultam” jelzés Box-járaton, nincs mihez mérni.">
        <div className="grid-2 pay-grid small">
          <div className="between"><span className="muted">Indulás a tervhez képest</span><span>{deps.length} alkalom</span></div>
          <div className="between"><span className="muted">Késve indult ({LATE_MIN} perc felett)</span><span style={{ color: lateDeps.length ? 'var(--danger)' : undefined }}>{lateDeps.length}</span></div>
          <div className="between"><span className="muted">Átlagos eltérés</span><span>{deps.length ? `${Math.round(sum(deps.map((d) => d.lateMin)) / deps.length)} perc` : '–'}</span></div>
          <div className="between"><span className="muted">Legnagyobb késés</span><span>{lateDeps.length ? `${Math.max(...lateDeps.map((d) => d.lateMin))} perc` : '–'}</span></div>
          <div className="between"><span className="muted">„Nem indult el” riasztás</span><span style={{ color: data.punctuality.alarms ? 'var(--danger)' : undefined }}>{data.punctuality.alarms}</span></div>
          <div className="between"><span className="muted">Ebből telefonhívás is ment</span><span>{data.punctuality.calls}</span></div>
        </div>
        {lateDeps.length > 0 && <Rows items={[...lateDeps].reverse()} first={5} render={(d) => (<>
          <span><strong>{formatDate(d.date)}</strong> <span className="muted">· {d.route ? `${d.route} járat · ` : ''}{d.round}. kör · terv {d.planned}, indult {d.actual}</span></span>
          <span className="num" style={{ whiteSpace: 'nowrap' }}>+{d.lateMin} perc</span>
        </>)} />}
      </Section>
      {data.punctuality.alarms > 0 && deps.length === 0 && <div className="tiny muted">„Nem indult el” riasztás az időszakban: {data.punctuality.alarms}</div>}

      <Section icon="map" title="Járat-tempó" count={data.tempo.runs.length} empty="Az időszakban nincs box-megálló napló.">
        <div className="grid-2 pay-grid small">
          <div className="between"><span className="muted">Lezárt box-megálló</span><span>{data.tempo.stops}</span></div>
          <div className="between"><span className="muted">Átlag két megálló között</span><span>{data.tempo.avgPerStop != null ? `${Math.round(data.tempo.avgPerStop)} perc` : '–'}</span></div>
          <div className="between"><span className="muted">Átlagos járatidő (első boxtól az utolsóig)</span><span>{avgRun != null ? hoursText(avgRun / 60) : '–'}</span></div>
          <div className="between"><span className="muted">Késett megálló</span><span>{data.tempo.lateStops}{data.tempo.avgLate != null ? ` · átlag ${Math.round(data.tempo.avgLate)} perc` : ''}</span></div>
        </div>
        <Rows items={[...data.tempo.runs].reverse()} first={5} render={(r) => (<>
          <span><strong>{formatDate(r.date)}</strong> <span className="muted">· {r.round}. kör · {r.stops} megálló</span></span>
          <span className="num" style={{ whiteSpace: 'nowrap' }}>{r.minutes > 0 ? hoursText(r.minutes / 60) : '–'}</span>
        </>)} />
      </Section>

      <Section icon="shield-check" title="Minőség" count={data.quality.stops} empty="Az időszakban nincs kitöltött Box-lap megálló.">
        <div className="grid-2 pay-grid small">
          <div className="between"><span className="muted">Nem behelyezett csomag 100 megállóra</span><span>{data.quality.per100 != null ? data.quality.per100.toLocaleString('hu-HU', { maximumFractionDigits: 1 }) : '–'}</span></div>
          <div className="between"><span className="muted">Nem behelyezett csomag összesen</span><span>{data.quality.problemTotal}</span></div>
          <div className="between"><span className="muted">Fotó nélküli megálló</span><span style={{ color: data.quality.noPhotoStops ? 'var(--danger)' : undefined }}>{data.quality.noPhotoStops}</span></div>
          <div className="between"><span className="muted">Box-hibabejelentés</span><span>{data.quality.boxIssues}</span></div>
        </div>
      </Section>

      {showPay && (
        <Section icon="calculator" title="Költség és hatékonyság">
          <div className="grid-2 pay-grid small">
            <div className="between"><span className="muted">XL bér egy sikeres címre</span><span>{data.efficiency.perXlAddress != null ? formatHuf(data.efficiency.perXlAddress) : '–'}</span></div>
            <div className="between"><span className="muted">Box bér egy megállóra</span><span>{data.efficiency.perBoxStop != null ? formatHuf(data.efficiency.perBoxStop) : '–'}</span></div>
            <div className="between"><span className="muted">Átlagfogyasztás</span><span>{data.efficiency.fuelAvg != null ? `${data.efficiency.fuelAvg.toLocaleString('hu-HU', { maximumFractionDigits: 1 })} l/100 km` : '–'}</span></div>
            <div className="between"><span className="muted">Levonás (kár, egyéb)</span><span style={{ color: data.efficiency.damage ? 'var(--danger)' : undefined }}>{formatHuf(data.efficiency.damage)}</span></div>
          </div>
          <div className="tiny muted">Az egy címre és megállóra jutó bér közelítés: az időszak XL, illetve Box bére osztva a rögzített címek, illetve megállók számával.</div>
        </Section>
      )}

      <Section icon="clock" title="Jelenlét és megbízhatóság">
        <div className="grid-2 pay-grid small">
          <div className="between"><span className="muted">Beosztott nap (a mai napig)</span><span>{data.attendance.assigned}</span></div>
          <div className="between"><span className="muted">Becsekkolt nap</span><span>{data.attendance.worked}</span></div>
          <div className="between"><span className="muted">Beosztva, de nem csekkolt be</span><span style={{ color: !noCheckins && data.attendance.missed.length ? 'var(--danger)' : undefined }}>{noCheckins ? '–' : data.attendance.missed.length}</span></div>
          <div className="between"><span className="muted">Igazolt távollét (szabadság, betegség)</span><span>{data.attendance.excused ?? 0} nap</span></div>
          <div className="between"><span className="muted">Telephelyen kívüli be- / kijelentkezés</span><span>{data.counts.outside}</span></div>
          <div className="between"><span className="muted">Napközbeni autócsere</span><span>{data.counts.switches}</span></div>
          <div className="between"><span className="muted">Cserekérés</span><span>{data.counts.swaps}</span></div>
          <div className="between"><span className="muted">Autó-ellenőrzés</span><span>{data.counts.inspections}</span></div>
          <div className="between"><span className="muted">Kézi becsekkolás (QR nélkül)</span><span>{data.discipline.manual}</span></div>
          <div className="between"><span className="muted">Ellenőrző fotó nélkül továbbengedve</span><span style={{ color: data.discipline.waived ? 'var(--danger)' : undefined }}>{data.discipline.waived}</span></div>
          <div className="between"><span className="muted">Este nem rakta le az autót</span><span style={{ color: data.discipline.notParked ? 'var(--danger)' : undefined }}>{data.discipline.notParked}</span></div>
          <div className="between"><span className="muted">Takarítás</span><span>{data.discipline.cleanings}{data.discipline.workedDays > 0 ? ` · ${data.discipline.workedDays} ledolgozott napra` : ''}</span></div>
        </div>
        {noCheckins && <div className="tiny muted">{p.status === 'invited' ? 'Még nem regisztrált az alkalmazásba, ezért nincs becsekkolása — a napjai a beosztásból látszanak.' : 'Az időszakban nem volt becsekkolása.'}</div>}
        {!noCheckins && data.attendance.missed.length > 0 && <div className="tiny muted">Kimaradt napok: {data.attendance.missed.slice(-12).map((d) => dayShort(d)).join(', ')}{data.attendance.missed.length > 12 ? ' …' : ''}</div>}
      </Section>

      <Section icon="fuel" title="Tankolások" count={data.fuel.length} empty="Az időszakban nem rögzített tankolást.">
        <div className="tiny muted">Összesen {formatHuf(fuelCost)} · {sum(data.fuel.map((f) => f.liters ?? 0)).toLocaleString('hu-HU', { maximumFractionDigits: 1 })} liter</div>
        <Rows items={data.fuel} render={(f) => (<>
          <span><strong>{formatDate(f.date)}</strong> <span className="muted">· {f.plate}{f.location ? ` · ${f.location}` : ''}{f.consumption ? ` · ${f.consumption.toLocaleString('hu-HU', { maximumFractionDigits: 1 })} l/100 km` : ''}</span></span>
          <span className="num" style={{ whiteSpace: 'nowrap' }}>{f.liters != null ? `${f.liters.toLocaleString('hu-HU', { maximumFractionDigits: 1 })} l · ` : ''}{formatHuf(f.amount)}</span>
        </>)} />
      </Section>
      <Section icon="alert-triangle" title="Törések, balesetek, események" count={data.incidents.length} empty="Az időszakban nem rögzített eseményt.">
        <Rows items={data.incidents} render={(x) => (<span><strong>{formatDate(x.date)}</strong> <span className="muted">· {x.plate}</span>{x.note ? ` — ${x.note}` : ''}</span>)} />
      </Section>
      <Section icon="wrench" title="Hibabejelentések" count={data.issues.length} empty="Az időszakban nem jelentett autó-hibát.">
        <Rows items={data.issues} render={(x) => (<>
          <span><strong>{formatDate(x.date)}</strong> <span className="muted">· {x.plate}</span>{x.note ? ` — ${x.note}` : ''}</span>
          <span className="badge">{x.status}</span>
        </>)} />
      </Section>
      <Section icon="sparkles" title="Takarítások" count={data.cleanings.length} empty="Az időszakban nem rögzített takarítást.">
        <div className="small">{data.cleanings.slice(0, 40).map((c) => `${dayShort(c.date)} ${c.plate}`).join(' · ')}{data.cleanings.length > 40 ? ' …' : ''}</div>
      </Section>
      <Section icon="package" title="Box-lapok" count={data.box.sheets} empty="Az időszakban nem töltött ki Box-lapot.">
        <div className="tiny muted">{data.box.stops} megálló · {data.box.placed.toLocaleString('hu-HU')} behelyezett csomag</div>
        {data.box.problems.some((x) => x.value > 0)
          ? <RankedBars color="var(--viz-1)" format={(n) => `${n} db`} rows={data.box.problems.filter((x) => x.value > 0)} />
          : <div className="tiny muted">Nem behelyezett csomag nem volt.</div>}
      </Section>
    </div>
  )
}
