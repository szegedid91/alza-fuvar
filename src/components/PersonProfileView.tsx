import { useState, type ReactNode } from 'react'
import Icon, { type IconName } from './Icon'
import { ChartCard, ColumnChart, LineChart, RankedBars, StatTile } from './charts/Charts'
import { compactHuf, dayShort, monthShort } from '../lib/chartUtils'
import { formatDate, formatHuf, roleLabel, statusLabel } from '../lib/labels'
import { monthTitle } from '../lib/calendar'
import type { MonthRow } from '../lib/personStats'
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
  attendance: { assigned: number; worked: number; missed: string[] }
  counts: { outside: number; switches: number; swaps: number; inspections: number; lateStops: number; avgLate: number | null }
  adjustments: { date: string; type: string; amount: number; reason: string | null }[]
  rateChanges: { from: string; driver: number; loader: number; box: number; box2: number; bonusOver: number; bonus: number }[]
  fuel: { date: string; plate: string; liters: number | null; amount: number | null; consumption: number | null; location: string | null }[]
  incidents: { date: string; plate: string; note: string | null }[]
  issues: { date: string; plate: string; note: string | null; status: string }[]
  cleanings: { date: string; plate: string }[]
  box: { sheets: number; stops: number; placed: number; problems: { label: string; value: number }[] }
}

const MONTH_FROM = ['januártól', 'februártól', 'márciustól', 'áprilistól', 'májustól', 'júniustól', 'júliustól', 'augusztustól', 'szeptembertől', 'októbertől', 'novembertől', 'decembertől']
const hoursText = (h: number) => `${h.toLocaleString('hu-HU', { maximumFractionDigits: 1 })} ó`
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)

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
        <StatTile label={dayWord} value={String(days)} sub={`${months.length} hónap alatt`} />
        {showPay && <StatTile label="Bér összesen" value={formatHuf(base)} sub={deductions > 0 ? `levonás: ${formatHuf(deductions)}` : 'levonás nélkül'} />}
        {showPay && <StatTile label="Felvett előleg" value={formatHuf(advances)} />}
        <StatTile label="Átlagos munkaidő" value={avgHours != null ? hoursText(avgHours) : '–'} sub={avgHours != null ? `${hourDays} lezárt nap alapján` : 'nincs lezárt nap'} />
        <StatTile label="Kimaradt nap" value={noCheckins ? '–' : String(data.attendance.missed.length)} sub={noCheckins ? 'nincs becsekkolás az időszakban' : `${data.attendance.assigned} beosztottból`} />
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
        {data.cars.length > 0 && (
          <ChartCard title="Melyik autón hány napot" subtitle="A beosztás szerint, a mai napig"
            table={{ head: ['Autó', 'Nap'], rows: data.cars.map((c) => [c.plate, c.days]) }}>
            <RankedBars color="var(--viz-1)" format={(n) => `${n} nap`} rows={data.cars.slice(0, 8).map((c) => ({ label: c.plate, value: c.days }))} />
          </ChartCard>
        )}
      </div>

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
        <Section icon="wallet" title="Előlegek és levonások" count={data.adjustments.length} empty="Az időszakban nem volt előleg vagy levonás.">
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

      <Section icon="clock" title="Jelenlét és megbízhatóság">
        <div className="grid-2 pay-grid small">
          <div className="between"><span className="muted">Beosztott nap (a mai napig)</span><span>{data.attendance.assigned}</span></div>
          <div className="between"><span className="muted">Becsekkolt nap</span><span>{data.attendance.worked}</span></div>
          <div className="between"><span className="muted">Beosztva, de nem csekkolt be</span><span style={{ color: !noCheckins && data.attendance.missed.length ? 'var(--danger)' : undefined }}>{noCheckins ? '–' : data.attendance.missed.length}</span></div>
          <div className="between"><span className="muted">Telephelyen kívüli be- / kijelentkezés</span><span>{data.counts.outside}</span></div>
          <div className="between"><span className="muted">Napközbeni autócsere</span><span>{data.counts.switches}</span></div>
          <div className="between"><span className="muted">Cserekérés</span><span>{data.counts.swaps}</span></div>
          <div className="between"><span className="muted">Autó-ellenőrzés</span><span>{data.counts.inspections}</span></div>
          <div className="between"><span className="muted">Késett box-megálló</span><span>{data.counts.lateStops}{data.counts.avgLate != null ? ` · átlag ${Math.round(data.counts.avgLate)} perc` : ''}</span></div>
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
