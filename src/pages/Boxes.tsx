import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAlzaBoxes } from '../hooks/useAlzaBoxes'
import { getCurrentPosition, distanceMeters } from '../lib/geo'
import { searchBoxes, formatDistance, type AlzaBox } from '../lib/boxSheet'
import { formatDateTime } from '../lib/labels'
import { toast } from '../lib/toast'
import BoxCard from '../components/BoxCard'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'

// AlzaBox kereső: kód / név / cím szerint, vagy a legközelebbiek GPS alapján.
// A futár egy koppintással látja, hol van a box (alza.hu leírás, fotó, navigáció).
export default function Boxes() {
  const { profile } = useAuth()
  const isManager = profile?.role === 'manager' || profile?.role === 'admin'
  const { data: boxes, isLoading, isError, error } = useAlzaBoxes()
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [geoErr, setGeoErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  type Hit = AlzaBox & { _dist: number | null }
  const results = useMemo<Hit[]>(() => {
    const all = boxes ?? []
    const dist = (b: AlzaBox) => (pos && b.lat != null && b.lng != null ? distanceMeters(pos.lat, pos.lng, b.lat, b.lng) : null)
    if (q.trim().length >= 2) return searchBoxes(all, q, 40).map((b) => ({ ...b, _dist: dist(b) }))
    if (pos) {
      return all.map((b) => ({ ...b, _dist: dist(b) })).filter((b) => b._dist != null)
        .sort((a, b) => a._dist! - b._dist!).slice(0, 25)
    }
    return []
  }, [boxes, q, pos])

  const sel = useMemo(() => results.find((b) => b.id === selected) ?? (boxes ?? []).map((b) => ({ ...b, _dist: null })).find((b) => b.id === selected) ?? null, [results, boxes, selected])
  const lastUpdated = useMemo(() => {
    let max = ''
    for (const b of boxes ?? []) if (b.updated_at > max) max = b.updated_at
    return max
  }, [boxes])

  async function locate() {
    setLocating(true); setGeoErr(null)
    const g = await getCurrentPosition()
    setLocating(false)
    if (g.lat == null || g.lng == null) { setGeoErr('Nem sikerült a helymeghatározás — engedélyezd a GPS-t, vagy keress kódra/névre.'); return }
    setPos({ lat: g.lat, lng: g.lng })
    setQ('')
  }

  return (
    <div className="stack">
      <h2>AlzaBox kereső</h2>
      <div className="card stack">
        <div className="input-icon">
          <Icon name="search" />
          <input className="input" value={q} onChange={(e) => { setQ(e.target.value); setSelected(null) }}
            placeholder="Box kód, név vagy cím (pl. AB9103, Csepel Penny)" autoComplete="off" />
        </div>
        <button type="button" className="btn ghost" disabled={locating || isLoading} onClick={() => void locate()}>
          <Icon name="navigation" />{locating ? 'Helymeghatározás…' : pos ? 'Legközelebbi boxok frissítése' : 'Legközelebbi boxok'}
        </button>
        {geoErr && <div className="alert warning">{geoErr}</div>}
        <div className="tiny muted">
          {boxes ? `${boxes.length} AlzaBox a jegyzékben` : 'Jegyzék betöltése…'}
          {lastUpdated && ` · frissítve: ${formatDateTime(lastUpdated)}`}
        </div>
      </div>

      {isLoading && <Skeleton rows={4} />}
      {isError && <div className="alert error">Nem sikerült betölteni a jegyzéket: {error instanceof Error ? error.message : ''}</div>}

      {sel ? (
        <>
          <BoxCard box={sel} distanceM={sel._dist} onClose={() => setSelected(null)} editable={isManager} />
          <button type="button" className="btn ghost" onClick={() => setSelected(null)}><Icon name="arrow-left" />Vissza a listához</button>
        </>
      ) : (
        <>
          {boxes && results.length === 0 && (q.trim().length >= 2 ? (
            <div className="empty">Nincs találat erre: „{q.trim()}"</div>
          ) : !pos && (
            <div className="empty"><span className="ico"><Icon name="package" size={40} /></span>Írd be a box kódját vagy nevét, vagy kérd a legközelebbieket.</div>
          ))}
          {results.length > 0 && (
            <div className="list">
              {pos && q.trim().length < 2 && <div className="tiny muted">A hozzád legközelebbi boxok:</div>}
              {results.map((b) => (
                <button key={b.id} type="button" className="list-item" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => setSelected(b.id)}>
                  <div className="between" style={{ gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 6 }}>
                        {b.code && <span className="badge primary num">{b.code}</span>}
                        <span className="name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                      </div>
                      <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.address}</div>
                    </div>
                    <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                      {b._dist != null && <span className="tiny muted num">{formatDistance(b._dist)}</span>}
                      <Icon name="chevron-right" className="muted" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {isManager && <ImportCard />}
    </div>
  )
}

// Menedzser: a jegyzék frissítése az alza.hu-ról begyűjtött listából (JSON beillesztés).
// Az alza.hu API-ját csak böngészőből lehet elérni (Cloudflare), ezért a lista
// gyűjtése külön lépés — a kapott JSON-t ide kell beilleszteni.
interface ImportRow { psid: number; name: string; address?: string | null; lat?: number | null; lng?: number | null; code?: string | null; photo?: string | null; article?: string | null; desc?: string | null }

function ImportCard() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [result, setResult] = useState<string | null>(null)

  const run = useMutation({
    mutationFn: async () => {
      let rows: ImportRow[]
      try { rows = JSON.parse(text) } catch { throw new Error('Nem érvényes JSON.') }
      if (!Array.isArray(rows)) throw new Error('A JSON-nak egy listának kell lennie.')
      const valid = rows.filter((r) => r && typeof r.psid === 'number' && typeof r.name === 'string' && r.name.trim())
      if (valid.length === 0) throw new Error('Nincs feldolgozható sor (psid + name kell).')
      const startedAt = new Date().toISOString()
      const toRow = (r: ImportRow) => ({
        parcel_shop_id: r.psid, name: r.name.trim(), address: r.address ?? null,
        lat: typeof r.lat === 'number' ? r.lat : null, lng: typeof r.lng === 'number' ? r.lng : null,
        code: r.code ?? null, photo_url: r.photo ?? null, article_url: r.article ?? null,
        description: r.desc ?? null, active: true,
      })
      for (let i = 0; i < valid.length; i += 200) {
        const { error } = await supabase.from('alza_boxes').upsert(valid.slice(i, i + 200).map(toRow), { onConflict: 'parcel_shop_id' })
        if (error) throw error
      }
      // ami a mostani listában nincs benne, az megszűnt (inaktív — a régi lapokon marad a hivatkozás)
      let deactivated = 0
      if (valid.length >= 100) {
        const { data, error } = await supabase.from('alza_boxes').update({ active: false }).lt('updated_at', startedAt).eq('active', true).select('id')
        if (error) throw error
        deactivated = data?.length ?? 0
      }
      return { imported: valid.length, deactivated }
    },
    onSuccess: (r) => {
      setResult(`Kész: ${r.imported} box frissítve${r.deactivated ? `, ${r.deactivated} megszűnt box inaktiválva` : ''}.`)
      setText('')
      toast.success('A jegyzék frissült.')
      void qc.invalidateQueries({ queryKey: ['alza-boxes'] })
    },
    onError: (e) => setResult(`Hiba: ${e instanceof Error ? e.message : 'az importálás nem sikerült'}`),
  })

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <button type="button" className="between" style={{ background: 'none', border: 'none', padding: 0, width: '100%', color: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => setOpen((o) => !o)}>
        <div className="card-title" style={{ margin: 0 }}><Icon name="upload" />Jegyzék frissítése (alza.hu)</div>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} className="muted" />
      </button>
      {open && (
        <>
          <p className="tiny muted" style={{ margin: 0 }}>
            Az alza.hu-ról begyűjtött AlzaBox-lista (JSON) beillesztése. Új boxok bekerülnek, a meglévők frissülnek
            (név, cím, GPS, „hol található" leírás, fotó), a listából hiányzók inaktívvá válnak. A saját megjegyzések megmaradnak.
          </p>
          <textarea className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder='[{"psid":1122884,"name":"…","address":"…","lat":47.6,"lng":16.5,"code":"AB9455","desc":"…"}]' />
          <button type="button" className="btn" disabled={!text.trim() || run.isPending} onClick={() => run.mutate()}>
            <Icon name="upload" />{run.isPending ? 'Importálás…' : 'Importálás'}
          </button>
          {result && <div className={`alert ${result.startsWith('Hiba') ? 'error' : 'success'}`}>{result}</div>}
        </>
      )}
    </div>
  )
}
