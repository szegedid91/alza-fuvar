import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import PhotoThumb from '../components/PhotoThumb'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useMembers } from '../hooks/useMembers'
import { useCars } from '../hooks/useCars'
import { resolveNames } from '../lib/names'
import { signedUrl, signedUrls, sha256Hex } from '../lib/photos'
import { inspectionViewLabel, evidenceCategoryLabel, carIssueStatusLabel, formatDateTime, parseHuNumber } from '../lib/labels'
import type { Enums } from '../lib/database.types'

type PhotoType = 'inspection' | 'fuel' | 'incident' | 'evidence' | 'issue'
type ViewFilter = Enums<'inspection_view'> | ''

interface Filters {
  carId: string
  userId: string
  from: string // YYYY-MM-DD vagy ''
  to: string
  view: ViewFilter // csak az Indulás (ellenőrző) fülön értelmezett
}

const VIEW_OPTIONS: Enums<'inspection_view'>[] = ['front', 'rear', 'left', 'right', 'interior']

interface Item {
  id: string
  path: string | null
  url?: string
  title: string
  subtitle: string
  when: string
}

const TABS: { key: PhotoType; label: string }[] = [
  { key: 'inspection', label: 'Indulás' },
  { key: 'fuel', label: 'Tankolás' },
  { key: 'incident', label: 'Baleset' },
  { key: 'evidence', label: 'Bizonyíték' },
  { key: 'issue', label: 'Autó-hiba' },
]

// Fotó-hitelesség ellenőrzése: a tárolt fájl hash-ét összevetjük a
// rögzítéskor mentett SHA-256-tal (photo_proofs). Eltérés = manipuláció.
function VerifyBadge({ path }: { path: string | null }) {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'tampered' | 'noproof' | 'error'>('idle')

  async function verify() {
    if (!path) return
    setState('busy')
    try {
      const { data: proof, error } = await supabase.from('photo_proofs').select('sha256').eq('storage_path', path).maybeSingle()
      // Lekérdezési hiba ≠ hiányzó hash — ne állítsuk tévesen "régi fotónak"
      if (error) { setState('error'); return }
      if (!proof) { setState('noproof'); return }
      const url = await signedUrl(path)
      if (!url) { setState('error'); return }
      const blob = await (await fetch(url)).blob()
      const hash = await sha256Hex(blob)
      setState(hash === proof.sha256 ? 'ok' : 'tampered')
    } catch {
      setState('error')
    }
  }

  if (!path) return null
  if (state === 'idle') return <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => void verify()}>🔎 Hitelesség</button>
  if (state === 'busy') return <span className="tiny muted">Ellenőrzés…</span>
  if (state === 'ok') return <span className="badge success" style={{ marginTop: 6 }}>✔ Hiteles</span>
  if (state === 'tampered') return <span className="badge danger" style={{ marginTop: 6 }}>⚠ Eltérés — manipulált!</span>
  if (state === 'noproof') return <span className="badge warning" style={{ marginTop: 6 }}>Nincs hash (régi fotó)</span>
  return <span className="badge danger" style={{ marginTop: 6 }}>Hiba az ellenőrzésnél</span>
}

// Kép-megőrzés beállítása (csak admin) — az automatikus takarítás ennyi nap
// után törli a fotókat (alap: 90 nap). A pénzügyi adatok megmaradnak.
function RetentionCard() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace, reload } = useWorkspace()
  const qc = useQueryClient()
  const [edit, setEdit] = useState(false)
  const [days, setDays] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      const n = Math.round(parseHuNumber(days))
      // Nem csendben kerekítünk 7-re — érvénytelen érték hibaüzenetet kap
      if (!Number.isFinite(n) || n < 7 || n > 3650) throw new Error('Érvénytelen érték — 7 és 3650 nap között adható meg')
      const { error } = await supabase.from('workspaces')
        .update({ photo_retention_days: n }).eq('id', currentWorkspaceId!)
      if (error) throw error
    },
    onSuccess: async () => { setEdit(false); await reload(); void qc.invalidateQueries() },
  })

  if (profile?.role !== 'admin') return null
  const current = currentWorkspace?.photo_retention_days ?? 90
  return (
    <div className="card stack">
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}>🗑️ Kép-megőrzés — {currentWorkspace?.name}</div>
        {!edit && <button className="btn ghost sm auto" onClick={() => { setDays(String(current)); setEdit(true) }}>Módosítás</button>}
      </div>
      {!edit ? (
        <div className="tiny muted">
          A fotók <strong>{current} napig</strong> ({Math.round(current / 30)} hónap) maradnak meg, utána automatikusan törlődnek.
          A pénz- és esemény-adatok megmaradnak, csak a képfájl törlődik.
        </div>
      ) : (
        <div className="stack">
          <div className="field">
            <label>Megőrzés (nap, min. 7 — alap 90 = 3 hónap)</label>
            <input className="input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          {save.isError && <div className="alert error">{save.error instanceof Error ? save.error.message : 'Hiba'}</div>}
          <div className="btn-grid">
            <button className="btn ghost sm" onClick={() => setEdit(false)}>Mégse</button>
            <button className="btn sm" disabled={save.isPending || !days} onClick={() => save.mutate()}>Mentés</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PhotoReview() {
  const [type, setType] = useState<PhotoType>('inspection')
  const { currentWorkspaceId } = useWorkspace()
  const { data: cars } = useCars()
  const { data: members } = useMembers()
  const [carId, setCarId] = useState('')
  const [userId, setUserId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [view, setView] = useState<ViewFilter>('')
  // Összehasonlító mód: két kép kiválasztása → egymás mellett
  const [compare, setCompare] = useState(false)
  const [picked, setPicked] = useState<string[]>([])

  const filters: Filters = { carId, userId, from, to, view }

  // Fül- vagy szűrőváltásnál a kijelölés elavul (a lista kicserélődik)
  useEffect(() => { setPicked([]) }, [type, carId, userId, from, to, view, currentWorkspaceId])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['photo-review', currentWorkspaceId, type, carId, userId, from, to, view],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const items = await fetchPhotos(type, filters, currentWorkspaceId!)
      // Kötegelt aláírás: 1 kérés a képenkénti helyett
      const urls = await signedUrls(items.map((i) => i.path).filter((p): p is string => !!p))
      return items.map((i) => ({ ...i, url: i.path ? urls[i.path] : undefined }))
    },
  })

  function togglePick(id: string) {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 2) return [prev[1], id] // a legrégebbi kiesik, max 2
      return [...prev, id]
    })
  }

  const pickedItems = (data ?? []).filter((i) => picked.includes(i.id))
    .sort((a, b) => picked.indexOf(a.id) - picked.indexOf(b.id))

  return (
    <div className="stack">
      <h2>Képek áttekintése</h2>

      <RetentionCard />

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={type === t.key ? 'active' : ''} onClick={() => setType(t.key)}>{t.label}</button>
        ))}
      </div>

      <div className="card stack">
        <div className="grid-2">
          <div className="field">
            <label>Autó</label>
            <select className="select" value={carId} onChange={(e) => setCarId(e.target.value)}>
              <option value="">— összes —</option>
              {cars?.map((c) => <option key={c.id} value={c.id}>{c.plate}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Munkatárs</label>
            <select className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">— összes —</option>
              {members?.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
            </select>
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Dátumtól</label>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>Dátumig</label>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {type === 'inspection' && (
          <div className="field">
            <label>Nézet</label>
            <select className="select" value={view} onChange={(e) => setView(e.target.value as ViewFilter)}>
              <option value="">— összes nézet —</option>
              {VIEW_OPTIONS.map((v) => <option key={v} value={v}>{inspectionViewLabel[v]}</option>)}
            </select>
          </div>
        )}
        <div className="btn-grid">
          {(carId || userId || from || to || view) && (
            <button className="btn ghost sm" onClick={() => { setCarId(''); setUserId(''); setFrom(''); setTo(''); setView('') }}>Szűrők törlése</button>
          )}
          <button
            className={`btn sm ${compare ? '' : 'secondary'}`}
            onClick={() => { setCompare((v) => !v); setPicked([]) }}
          >
            {compare ? `⚖️ Összehasonlítás (${picked.length}/2)` : '⚖️ Összehasonlítás'}
          </button>
        </div>
        {compare && picked.length < 2 && (
          <div className="tiny muted">Koppints két képre a listában — egymás mellé tesszük őket (pl. tegnapi és mai jobb oldal).</div>
        )}
      </div>

      {compare && pickedItems.length === 2 && (
        <div className="card stack" style={{ borderColor: 'var(--primary)' }}>
          <div className="between">
            <div className="card-title" style={{ margin: 0 }}>⚖️ Összehasonlítás</div>
            <button className="btn ghost sm auto" onClick={() => setPicked([])}>✕ Bezárás</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {pickedItems.map((it, idx) => (
              <div key={it.id} className="stack" style={{ gap: 4 }}>
                <span className="badge primary" style={{ width: 'fit-content' }}>{idx + 1}.</span>
                {it.url
                  ? <img
                      src={it.url}
                      alt=""
                      style={{ width: '100%', borderRadius: 10, cursor: 'zoom-in' }}
                      onClick={() => window.open(it.url, '_blank')}
                    />
                  : <div className="thumb thumb-empty"><div className="spinner" /></div>}
                <div className="small" style={{ fontWeight: 700 }}>{it.title}</div>
                <div className="tiny muted">{it.subtitle}</div>
                <div className="tiny muted">{it.when}</div>
              </div>
            ))}
          </div>
          <div className="tiny muted">Koppints egy képre a teljes méretű megnyitáshoz.</div>
        </div>
      )}

      {isLoading && <div className="card"><div className="spinner" /></div>}
      {isError && <div className="alert error">A képek betöltése nem sikerült. Frissítsd az oldalt.</div>}
      {!isLoading && !isError && (data?.length ?? 0) === 0 && <div className="empty"><span className="ico">📷</span>Nincs kép a szűrésnek megfelelően.</div>}
      {!isLoading && (data?.length ?? 0) > 0 && <div className="tiny muted">{data!.length} kép</div>}

      <div className="grid-2">
        {data?.map((it) => {
          const pickIdx = picked.indexOf(it.id)
          return (
            <div
              key={it.id}
              className="card"
              style={{
                padding: 10,
                cursor: compare ? 'pointer' : undefined,
                border: pickIdx > -1 ? '2px solid var(--primary)' : undefined,
              }}
              onClick={compare ? () => togglePick(it.id) : undefined}
            >
              {pickIdx > -1 && <span className="badge primary" style={{ marginBottom: 6 }}>{pickIdx + 1}. kiválasztva</span>}
              <PhotoThumb path={it.path} src={it.url} />
              <div style={{ marginTop: 8 }}>
                <div className="small" style={{ fontWeight: 700 }}>{it.title}</div>
                <div className="tiny muted">{it.subtitle}</div>
                <div className="tiny muted">{it.when}</div>
                {!compare && <VerifyBadge path={it.path} />}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Dátum-szűrés alkalmazása egy query-builderre (taken_at/created_at oszlopon).
// A helyi naptári napot UTC-pillanatokra váltjuk — a nyers "T00:00:00" szöveget
// a Postgres UTC-ként értené, és a hajnali fotók a szomszéd napra csúsznának.
function dateRange<T extends { gte: (c: string, v: string) => T; lt: (c: string, v: string) => T }>(
  q: T, col: string, f: Filters,
): T {
  let out = q
  if (f.from) {
    const [y, m, d] = f.from.split('-').map(Number)
    out = out.gte(col, new Date(y, m - 1, d).toISOString())
  }
  if (f.to) {
    const [y, m, d] = f.to.split('-').map(Number)
    out = out.lt(col, new Date(y, m - 1, d + 1).toISOString())
  }
  return out
}

async function fetchPhotos(type: PhotoType, f: Filters, ws: string): Promise<Item[]> {
  if (type === 'inspection') {
    // !inner: az autó/személy szűrő a szülő ellenőrzésen keresztül érvényesül
    let q = supabase
      .from('car_inspection_photos')
      .select('id, storage_path, view, taken_at, inspection:car_inspections!inner(user_id, car_id, car:cars(plate))')
      .eq('workspace_id', ws)
      .order('taken_at', { ascending: false }).limit(60)
    if (f.carId) q = q.eq('inspection.car_id', f.carId)
    if (f.userId) q = q.eq('inspection.user_id', f.userId)
    if (f.view) q = q.eq('view', f.view)
    q = dateRange(q, 'taken_at', f)
    const { data, error } = await q
    if (error) throw error
    const rows = data ?? []
    const names = await resolveNames(rows.map((r) => (r.inspection as unknown as { user_id: string } | null)?.user_id))
    return rows.map((r) => {
      const insp = r.inspection as unknown as { user_id: string; car: { plate: string } | null } | null
      return {
        id: r.id, path: r.storage_path, title: `${insp?.car?.plate ?? '—'} · ${inspectionViewLabel[r.view]}`,
        subtitle: insp?.user_id ? names[insp.user_id] ?? '' : '', when: formatDateTime(r.taken_at),
      }
    })
  }

  if (type === 'fuel') {
    let q = supabase
      .from('fuel_logs').select('id, photo_path, user_id, amount, liters, taken_at, car:cars(plate)')
      .eq('workspace_id', ws)
      .not('photo_path', 'is', null).order('taken_at', { ascending: false }).limit(60)
    if (f.carId) q = q.eq('car_id', f.carId)
    if (f.userId) q = q.eq('user_id', f.userId)
    q = dateRange(q, 'taken_at', f)
    const { data, error } = await q
    if (error) throw error
    const rows = data ?? []
    const names = await resolveNames(rows.map((r) => r.user_id))
    return rows.map((r) => ({
      id: r.id, path: r.photo_path,
      title: `${(r.car as unknown as { plate: string } | null)?.plate ?? '—'} · ${new Intl.NumberFormat('hu-HU', { style: 'currency', currency: 'HUF', maximumFractionDigits: 0 }).format(Number(r.amount ?? 0))}`,
      subtitle: `${r.liters ?? '?'} l · ${names[r.user_id] ?? ''}`, when: formatDateTime(r.taken_at),
    }))
  }

  if (type === 'incident') {
    let q = supabase
      .from('incidents').select('id, photo_path, user_id, note, taken_at, car:cars(plate)')
      .eq('workspace_id', ws)
      .not('photo_path', 'is', null).order('taken_at', { ascending: false }).limit(60)
    if (f.carId) q = q.eq('car_id', f.carId)
    if (f.userId) q = q.eq('user_id', f.userId)
    q = dateRange(q, 'taken_at', f)
    const { data, error } = await q
    if (error) throw error
    const rows = data ?? []
    const names = await resolveNames(rows.map((r) => r.user_id))
    return rows.map((r) => ({
      id: r.id, path: r.photo_path, title: (r.car as unknown as { plate: string } | null)?.plate ?? 'Esemény',
      subtitle: `${r.note ?? ''} · ${names[r.user_id] ?? ''}`, when: formatDateTime(r.taken_at),
    }))
  }

  if (type === 'issue') {
    let q = supabase
      .from('car_issues').select('id, photo_path, user_id, note, status, created_at, car:cars(plate)')
      .eq('workspace_id', ws)
      .not('photo_path', 'is', null).order('created_at', { ascending: false }).limit(60)
    if (f.carId) q = q.eq('car_id', f.carId)
    if (f.userId) q = q.eq('user_id', f.userId)
    q = dateRange(q, 'created_at', f)
    const { data, error } = await q
    if (error) throw error
    const rows = data ?? []
    const names = await resolveNames(rows.map((r) => r.user_id))
    return rows.map((r) => ({
      id: r.id, path: r.photo_path,
      title: `${(r.car as unknown as { plate: string } | null)?.plate ?? '—'} · ${carIssueStatusLabel[r.status]}`,
      subtitle: `${r.note} · ${names[r.user_id] ?? ''}`, when: formatDateTime(r.created_at),
    }))
  }

  // evidence
  let q = supabase
    .from('evidence_photos').select('id, photo_path, category, note, created_by, created_at, car:cars(plate)')
    .eq('workspace_id', ws)
    .not('photo_path', 'is', null).order('created_at', { ascending: false }).limit(60)
  if (f.carId) q = q.eq('car_id', f.carId)
  if (f.userId) q = q.eq('created_by', f.userId)
  q = dateRange(q, 'created_at', f)
  const { data, error } = await q
  if (error) throw error
  const rows = data ?? []
  const names = await resolveNames(rows.map((r) => r.created_by))
  return rows.map((r) => ({
    id: r.id, path: r.photo_path, title: `${(r.car as unknown as { plate: string } | null)?.plate ?? '—'} · ${evidenceCategoryLabel[r.category]}`,
    subtitle: `${r.note ?? ''} · ${r.created_by ? names[r.created_by] ?? '' : ''}`, when: formatDateTime(r.created_at),
  }))
}
