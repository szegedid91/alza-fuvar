import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useCars, type Car } from '../hooks/useCars'
import { useCarCategories } from '../hooks/useCarCategories'
import ConfirmButton from '../components/ConfirmButton'
import { carQrPayload, qrDataUrl } from '../lib/qr'

// Kategóriák kezelése: előbb a kategória, aztán rendeled hozzá az autókat
// (több autó van, mint kategória). Sorrend = a heti beosztás-táblázat sorrendje.
function CategoriesCard({ cars }: { cars: Car[] }) {
  const { currentWorkspaceId } = useWorkspace()
  const qc = useQueryClient()
  const { data: categories } = useCarCategories()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['car-categories'] })
    void qc.invalidateQueries({ queryKey: ['cars'] })
  }
  const fail = (what: string) => (e: unknown) => setError(`${what}: ${e instanceof Error ? e.message : 'ismeretlen hiba'}`)

  const add = useMutation({
    mutationFn: async () => {
      const n = name.trim()
      if (!n) throw new Error('Adj meg egy nevet')
      const { error } = await supabase.from('car_categories')
        .insert({ workspace_id: currentWorkspaceId!, name: n, sort_order: (categories?.length ?? 0) + 1 })
      if (error) throw error
    },
    onSuccess: () => { setName(''); setError(null); invalidate() },
    onError: fail('A kategória létrehozása nem sikerült'),
  })
  const rename = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) => {
      const n = value.trim()
      if (!n) throw new Error('A név nem lehet üres')
      const { error } = await supabase.from('car_categories').update({ name: n }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { setRenaming(null); setError(null); invalidate() },
    onError: fail('Az átnevezés nem sikerült'),
  })
  const setCrew = useMutation({
    mutationFn: async ({ id, crew_size }: { id: string; crew_size: 1 | 2 }) => {
      const { error } = await supabase.from('car_categories').update({ crew_size }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { setError(null); invalidate() },
    onError: fail('A létszám mentése nem sikerült'),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('car_categories').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { setError(null); invalidate() },
    onError: fail('A törlés nem sikerült'),
  })
  const move = useMutation({
    mutationFn: async ({ id, dir }: { id: string; dir: -1 | 1 }) => {
      const ids = (categories ?? []).map((c) => c.id)
      const i = ids.indexOf(id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= ids.length) return
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
      // Teljes sorrend újraírása (nincs duplikált sort_order)
      const results = await Promise.all(ids.map((cid, idx) => supabase.from('car_categories').update({ sort_order: idx + 1 }).eq('id', cid)))
      const bad = results.find((r) => r.error)
      if (bad?.error) throw bad.error
    },
    onSuccess: () => { setError(null); invalidate() },
    onError: fail('A sorrend mentése nem sikerült'),
  })
  const assign = useMutation({
    mutationFn: async ({ carId, categoryId }: { carId: string; categoryId: string | null }) => {
      const { error } = await supabase.from('cars').update({ category_id: categoryId }).eq('id', carId)
      if (error) throw error
    },
    onSuccess: () => { setError(null); invalidate() },
    onError: fail('Az autó hozzárendelése nem sikerült'),
  })

  const uncategorized = cars.filter((c) => !c.category_id)
  const nameOf = (id: string | null) => (categories ?? []).find((c) => c.id === id)?.name
  const iconBtn = { minHeight: 30, width: 30, padding: 0, fontSize: 13 } as const
  const chip = (car: Car, onRemove?: () => void) => (
    <span key={car.id} className="badge" style={{ gap: 5, fontSize: 12, padding: '2px 8px' }}>
      {car.plate}{!car.active && <span className="tiny muted">(inaktív)</span>}
      {onRemove && (
        <button type="button" onClick={onRemove} title="Kivétel a kategóriából"
          style={{ border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
      )}
    </span>
  )

  return (
    <div className="card stack" style={{ gap: 8, padding: 12 }}>
      <div className="between">
        <div className="card-title" style={{ margin: 0 }}>🗂️ Kategóriák</div>
        <span className="tiny muted">sorrend = beosztás sorrendje</span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="input" style={{ minHeight: 38, padding: '6px 10px', fontSize: 14 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Új kategória neve…"
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) add.mutate() }} />
        <button className="btn sm auto" style={{ minHeight: 38 }} disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>➕</button>
      </div>
      {error && <div className="alert error">{error}</div>}

      {(categories ?? []).map((cat, idx) => {
        const inCat = cars.filter((c) => c.category_id === cat.id)
        const candidates = cars.filter((c) => c.category_id !== cat.id)
        return (
          <div key={cat.id} className="stack" style={{ gap: 5, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
            <div className="between" style={{ gap: 6 }}>
              {renaming === cat.id ? (
                <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                  <input className="input" style={{ minHeight: 32, padding: '4px 8px', fontSize: 14 }} value={renameVal} autoFocus onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') rename.mutate({ id: cat.id, value: renameVal }); if (e.key === 'Escape') setRenaming(null) }} />
                  <button className="btn sm auto" style={iconBtn} onClick={() => rename.mutate({ id: cat.id, value: renameVal })}>✔</button>
                  <button className="btn ghost sm auto" style={iconBtn} onClick={() => setRenaming(null)}>✕</button>
                </div>
              ) : (
                <div style={{ fontWeight: 800, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cat.name} <span className="tiny muted">· {inCat.length}</span>
                </div>
              )}
              {renaming !== cat.id && (
                <div style={{ display: 'flex', gap: 3, flexShrink: 0, alignItems: 'center' }}>
                  <div title="Szükséges létszám" style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 999, overflow: 'hidden', marginRight: 4 }}>
                    {([1, 2] as const).map((n) => (
                      <button key={n} type="button" disabled={setCrew.isPending}
                        onClick={() => { if (cat.crew_size !== n) setCrew.mutate({ id: cat.id, crew_size: n }) }}
                        style={{
                          border: 'none', cursor: 'pointer', minHeight: 28, padding: '0 8px', fontSize: 11, fontWeight: 700,
                          background: cat.crew_size === n ? 'var(--primary-ghost)' : 'transparent',
                          color: cat.crew_size === n ? 'var(--primary)' : 'var(--text-dim)',
                        }}>
                        {n === 1 ? '👤 1 fő' : '👥 2 fő'}
                      </button>
                    ))}
                  </div>
                  <button className="btn ghost sm auto" style={iconBtn} title="Feljebb" disabled={idx === 0 || move.isPending} onClick={() => move.mutate({ id: cat.id, dir: -1 })}>↑</button>
                  <button className="btn ghost sm auto" style={iconBtn} title="Lejjebb" disabled={idx === (categories?.length ?? 0) - 1 || move.isPending} onClick={() => move.mutate({ id: cat.id, dir: 1 })}>↓</button>
                  <button className="btn ghost sm auto" style={iconBtn} title="Átnevezés" onClick={() => { setRenaming(cat.id); setRenameVal(cat.name) }}>✏️</button>
                  <ConfirmButton style={iconBtn} title="Törlés" disabled={remove.isPending} confirmLabel="Törlés"
                    onConfirm={() => remove.mutate(cat.id)}>🗑️</ConfirmButton>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
              {inCat.map((c) => chip(c, () => assign.mutate({ carId: c.id, categoryId: null })))}
              {candidates.length > 0 && (
                <select className="select" style={{ minHeight: 30, padding: '3px 8px', fontSize: 12, width: 'auto', maxWidth: 200, borderRadius: 999 }} value=""
                  onChange={(e) => { if (e.target.value) assign.mutate({ carId: e.target.value, categoryId: cat.id }) }}>
                  <option value="">＋ autó…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.plate}{c.category_id ? ` (most: ${nameOf(c.category_id) ?? '?'})` : ''}
                    </option>
                  ))}
                </select>
              )}
              {inCat.length === 0 && candidates.length === 0 && <span className="tiny muted">nincs autó</span>}
            </div>
          </div>
        )
      })}

      {(categories?.length ?? 0) > 0 && uncategorized.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          <span className="tiny muted">Kategória nélkül:</span>
          {uncategorized.map((c) => chip(c))}
        </div>
      )}
    </div>
  )
}

export default function Cars() {
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const qc = useQueryClient()
  const [plate, setPlate] = useState('')
  const [label, setLabel] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [qrCar, setQrCar] = useState<Car | null>(null)
  const [printAll, setPrintAll] = useState(false)
  const [panel, setPanel] = useState<'none' | 'add' | 'categories'>('none')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all') // all | active | inactive | none | <categoryId>
  const [openId, setOpenId] = useState<string | null>(null)
  const [editPlate, setEditPlate] = useState('')
  const [editLabel, setEditLabel] = useState('')
  const openRow = (car: Car | null) => {
    setOpenId(car?.id ?? null)
    setEditPlate(car?.plate ?? '')
    setEditLabel(car?.label ?? '')
  }

  const { data: cars, isLoading } = useCars()
  const { data: categories } = useCarCategories()
  const categoryName = (id: string | null) => (categories ?? []).find((c) => c.id === id)?.name

  const addCar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('cars').insert({
        workspace_id: currentWorkspaceId!,
        plate: plate.trim().toUpperCase(),
        label: label.trim() || null,
        category_id: newCategory || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setPlate(''); setLabel(''); setNewCategory(''); setError(null); setPanel('none')
      void qc.invalidateQueries({ queryKey: ['cars'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Hiba'),
  })

  const toggleActive = useMutation({
    mutationFn: async (car: Car) => {
      const { error } = await supabase.from('cars').update({ active: !car.active }).eq('id', car.id)
      if (error) throw error
    },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['cars'] }) },
    onError: (e) => setError('Az autó állapotának módosítása nem sikerült: ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })

  const editCar = useMutation({
    mutationFn: async (car: Car) => {
      const p = editPlate.trim().toUpperCase()
      if (!p) throw new Error('A rendszám nem lehet üres')
      const { error } = await supabase.from('cars').update({ plate: p, label: editLabel.trim() || null }).eq('id', car.id)
      if (error) throw error
    },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['cars'] }) },
    onError: (e) => setError('A mentés nem sikerült: ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })

  const assign = useMutation({
    mutationFn: async ({ carId, categoryId }: { carId: string; categoryId: string | null }) => {
      const { error } = await supabase.from('cars').update({ category_id: categoryId }).eq('id', carId)
      if (error) throw error
    },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['cars'] }) },
    onError: (e) => setError('A kategória mentése nem sikerült: ' + (e instanceof Error ? e.message : 'ismeretlen hiba')),
  })

  if (qrCar) return <QrView car={qrCar} onBack={() => setQrCar(null)} />
  if (printAll) return <QrSheet cars={(cars ?? []).filter((c) => c.active)} onBack={() => setPrintAll(false)} />

  const all = cars ?? []
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const q = norm(search.trim())
  const counts = {
    active: all.filter((c) => c.active).length,
    inactive: all.filter((c) => !c.active).length,
    none: all.filter((c) => !c.category_id).length,
  }
  const visible = all.filter((c) => {
    if (filter === 'active' && !c.active) return false
    if (filter === 'inactive' && c.active) return false
    if (filter === 'none' && c.category_id) return false
    if (!['all', 'active', 'inactive', 'none'].includes(filter) && c.category_id !== filter) return false
    if (!q) return true
    return norm(c.plate).includes(q) || norm(c.label ?? '').includes(q) || norm(categoryName(c.category_id) ?? '').includes(q)
  })
  // Szűrés nélkül kategóriánként csoportosítva (a beosztás sorrendjében), különben lapos lista
  const grouped = filter === 'all' && !q && (categories?.length ?? 0) > 0
  const sections: { title: string | null; cars: Car[] }[] = grouped
    ? [
        ...(categories ?? []).map((c) => ({ title: c.name, cars: visible.filter((x) => x.category_id === c.id) })).filter((sec) => sec.cars.length > 0),
        ...(visible.some((x) => !x.category_id) ? [{ title: 'Kategória nélkül', cars: visible.filter((x) => !x.category_id) }] : []),
      ]
    : [{ title: null, cars: visible }]
  const chip = (key: string, text: string, n: number) => (
    <button key={key} className={`badge ${filter === key ? 'primary' : ''}`}
      style={{ cursor: 'pointer', border: filter === key ? '1px solid var(--primary)' : undefined }}
      onClick={() => setFilter(key)}>
      {text} · {n}
    </button>
  )

  return (
    <div className="stack">
      <div className="between">
        <h2>Autók — {currentWorkspace?.name ?? ''}</h2>
        <span className="badge">{all.length} autó</span>
      </div>

      <div className="btn-grid">
        <button className={`btn sm ${panel === 'add' ? '' : 'secondary'}`} onClick={() => setPanel(panel === 'add' ? 'none' : 'add')}>➕ Új autó</button>
        <button className={`btn sm ${panel === 'categories' ? '' : 'secondary'}`} onClick={() => setPanel(panel === 'categories' ? 'none' : 'categories')}>
          🗂️ Kategóriák{(categories?.length ?? 0) > 0 ? ` (${categories!.length})` : ''}
        </button>
      </div>

      {panel === 'add' && (
        <div className="card stack">
          <div className="between">
            <div className="card-title" style={{ margin: 0 }}>Új autó</div>
            <button className="btn ghost sm auto" onClick={() => setPanel('none')}>Bezárás</button>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Rendszám</label>
              <input className="input" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="ABC-123" autoCapitalize="characters" />
            </div>
            <div className="field">
              <label>Megnevezés (opcionális)</label>
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ford Transit fehér" />
            </div>
          </div>
          {(categories?.length ?? 0) > 0 && (
            <div className="field">
              <label>Kategória</label>
              <select className="select" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                <option value="">— nincs —</option>
                {categories!.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {error && <div className="alert error">{error}</div>}
          <button className="btn" disabled={!plate.trim() || addCar.isPending} onClick={() => addCar.mutate()}>
            {addCar.isPending ? 'Mentés…' : 'Autó hozzáadása'}
          </button>
        </div>
      )}

      {panel === 'categories' && (
        <div className="stack" style={{ gap: 6 }}>
          <div style={{ textAlign: 'right' }}>
            <button className="btn ghost sm auto" onClick={() => setPanel('none')}>Bezárás</button>
          </div>
          <CategoriesCard cars={all} />
        </div>
      )}

      {panel === 'none' && error && <div className="alert error">{error}</div>}

      {all.length > 0 && (
        <div className="card stack" style={{ gap: 10 }}>
          <input className="input" placeholder="🔍 Keresés rendszám, megnevezés, kategória…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {chip('all', 'Mind', all.length)}
            {chip('active', 'Aktív', counts.active)}
            {counts.inactive > 0 && chip('inactive', 'Inaktív', counts.inactive)}
            {(categories ?? []).map((c) => chip(c.id, c.name, all.filter((x) => x.category_id === c.id).length))}
            {counts.none > 0 && (categories?.length ?? 0) > 0 && chip('none', 'Kategória nélkül', counts.none)}
          </div>
        </div>
      )}

      {isLoading && <div className="card"><div className="spinner" /></div>}
      {!isLoading && all.length === 0 && (
        <div className="empty"><span className="ico">🚗</span>Még nincs autó. Koppints az „➕ Új autó" gombra.</div>
      )}
      {!isLoading && all.length > 0 && visible.length === 0 && (
        <div className="empty"><span className="ico">🔍</span>Nincs találat a szűrésre.</div>
      )}

      {sections.map((sec) => sec.cars.length > 0 && (
        <div key={sec.title ?? '_all'} className="card" style={{ padding: 6 }}>
          {sec.title && (
            <div className="tiny muted" style={{ padding: '6px 10px 2px', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
              🗂️ {sec.title} · {sec.cars.length}
            </div>
          )}
          {sec.cars.map((car) => {
            const open = openId === car.id
            const cat = categoryName(car.category_id)
            return (
              <div key={car.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <button type="button" onClick={() => openRow(open ? null : car)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px',
                    background: open ? 'var(--primary-ghost)' : 'transparent', border: 'none', color: 'inherit',
                    cursor: 'pointer', textAlign: 'left', borderRadius: 10, opacity: car.active ? 1 : 0.55,
                  }}>
                  <div style={{ fontSize: 22, flexShrink: 0 }}>🚚</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '0.02em' }}>{car.plate}</div>
                    <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {car.label || 'Nincs megnevezés'}
                    </div>
                  </div>
                  {cat && !grouped && <span className="badge primary">🗂️ {cat}</span>}
                  {!car.active && <span className="badge danger">Inaktív</span>}
                  <span className="muted" style={{ fontSize: 12, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }}>›</span>
                </button>
                {open && (
                  <div className="stack" style={{ padding: '4px 10px 12px', gap: 10 }}>
                    <div className="grid-2">
                      <div className="field">
                        <label>Rendszám</label>
                        <input className="input" value={editPlate} onChange={(e) => setEditPlate(e.target.value)} autoCapitalize="characters" />
                      </div>
                      <div className="field">
                        <label>Megnevezés</label>
                        <input className="input" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="pl. Ford Transit fehér" />
                      </div>
                    </div>
                    {(editPlate.trim() !== car.plate || editLabel.trim() !== (car.label ?? '')) && (
                      <button className="btn sm" disabled={editCar.isPending || !editPlate.trim()} onClick={() => editCar.mutate(car)}>
                        💾 Módosítások mentése
                      </button>
                    )}
                    {(categories?.length ?? 0) > 0 && (
                      <div className="field">
                        <label>Kategória</label>
                        <select className="select" value={car.category_id ?? ''} disabled={assign.isPending}
                          onChange={(e) => assign.mutate({ carId: car.id, categoryId: e.target.value || null })}>
                          <option value="">— nincs —</option>
                          {categories!.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                    )}
                    <div className="btn-grid">
                      <button className="btn secondary sm" onClick={() => setQrCar(car)}>📱 QR-kód</button>
                      {car.active ? (
                        <ConfirmButton className="btn ghost sm" confirmLabel="Igen, inaktiválom" disabled={toggleActive.isPending} onConfirm={() => toggleActive.mutate(car)}>
                          ⏸ Inaktiválás
                        </ConfirmButton>
                      ) : (
                        <button className="btn sm" disabled={toggleActive.isPending} onClick={() => toggleActive.mutate(car)}>▶️ Aktiválás</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {all.some((c) => c.active) && (
        <button className="btn ghost sm" onClick={() => setPrintAll(true)}>🖨️ Összes aktív autó QR-kódja egy lapon</button>
      )}
    </div>
  )
}

function QrCell({ car }: { car: Car }) {
  const { data: dataUrl } = useQuery({ queryKey: ['qr', car.id], queryFn: () => qrDataUrl(carQrPayload(car.qr_token)) })
  return (
    <div className="qr-card" style={{ padding: 12, breakInside: 'avoid' }}>
      {dataUrl ? <img src={dataUrl} alt="QR" style={{ maxWidth: 180 }} /> : <div className="spinner" />}
      <div className="plate" style={{ fontSize: 18 }}>{car.plate}</div>
      {car.label && <div style={{ color: '#555', fontSize: 13 }}>{car.label}</div>}
    </div>
  )
}

function QrSheet({ cars, onBack }: { cars: Car[]; onBack: () => void }) {
  return (
    <div className="stack">
      <div className="btn-grid no-print">
        <button className="btn ghost" onClick={onBack}>← Vissza</button>
        <button className="btn" onClick={() => window.print()}>🖨️ Nyomtatás</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {cars.map((c) => <QrCell key={c.id} car={c} />)}
      </div>
    </div>
  )
}

function QrView({ car, onBack }: { car: Car; onBack: () => void }) {
  const { data: dataUrl } = useQuery({
    queryKey: ['qr', car.id],
    queryFn: () => qrDataUrl(carQrPayload(car.qr_token)),
  })
  return (
    <div className="stack">
      <button className="btn ghost auto no-print" onClick={onBack}>← Vissza</button>
      <div className="qr-card">
        {dataUrl ? <img src={dataUrl} alt="QR" /> : <div className="spinner" />}
        <div className="plate">{car.plate}</div>
        {car.label && <div style={{ color: '#555' }}>{car.label}</div>}
        <div style={{ color: '#777', fontSize: 12, marginTop: 6 }}>Alza — becsekkoláshoz olvasd be</div>
      </div>
      <button className="btn no-print" onClick={() => window.print()}>🖨️ Nyomtatás</button>
      <p className="tiny muted no-print">Nyomtasd ki és ragaszd az autóra. A QR-kód fix, nem változik.</p>
    </div>
  )
}
