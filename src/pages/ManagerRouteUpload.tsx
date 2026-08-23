import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useCars } from '../hooks/useCars'
import { parseRouteExcel } from '../lib/excel'
import { todayISO, formatDate } from '../lib/labels'

export default function ManagerRouteUpload() {
  const { profile } = useAuth()
  const { currentWorkspaceId, currentWorkspace } = useWorkspace()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [carId, setCarId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [startPoi, setStartPoi] = useState('')
  const [endPoi, setEndPoi] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const { data: cars } = useCars(true)

  const { data: uploads } = useQuery({
    queryKey: ['mgr-uploads', currentWorkspaceId],
    enabled: !!currentWorkspaceId,
    queryFn: async () => {
      const { data } = await supabase.from('route_uploads')
        .select('*, car:cars(plate)').eq('workspace_id', currentWorkspaceId!)
        .order('work_date', { ascending: false }).limit(15)
      return data ?? []
    },
  })

  async function handleFile(file: File) {
    if (!currentWorkspaceId || !profile || !carId) { setMsg('Válassz autót.'); return }
    setBusy(true); setMsg(null)
    try {
      const stops = await parseRouteExcel(file)
      if (stops.length === 0) { setMsg('Nem találtam stopokat.'); setBusy(false); return }
      // Ha a meglévő fuvartervben már vannak rögzített stopok (pénz!), kérdezzünk rá
      const { data: existing } = await supabase.from('route_uploads')
        .select('id').eq('workspace_id', currentWorkspaceId).eq('car_id', carId).eq('work_date', date)
      if ((existing?.length ?? 0) > 0) {
        const { count } = await supabase.from('route_stops')
          .select('id', { count: 'exact', head: true })
          .in('upload_id', existing!.map((u) => u.id))
          .not('recorded_by', 'is', null)
        if ((count ?? 0) > 0 && !confirm(`A meglévő fuvartervben már ${count} rögzített stop van (beszedett pénzzel). Felülírod? A rögzített adatok VÉGLEGESEN törlődnek!`)) {
          setBusy(false)
          return
        }
      }
      // meglévő ugyanarra a nap+autóra törlése — ha nem sikerül (pl. zárolt hónap),
      // NEM mehetünk tovább, különben dupla fuvarterv duplázná a napi pénzösszesítőt
      const { error: delErr } = await supabase.from('route_uploads').delete()
        .eq('workspace_id', currentWorkspaceId).eq('car_id', carId).eq('work_date', date)
      if (delErr) throw new Error('A korábbi fuvarterv törlése nem sikerült: ' + delErr.message)

      const uploadId = crypto.randomUUID()
      const { error: uErr } = await supabase.from('route_uploads').insert({
        id: uploadId, workspace_id: currentWorkspaceId, work_date: date, car_id: carId,
        uploaded_by: profile.id, file_name: file.name, start_poi: startPoi.trim() || null, end_poi: endPoi.trim() || null,
      })
      if (uErr) throw uErr
      const rows = stops.map((s, i) => ({
        upload_id: uploadId, workspace_id: currentWorkspaceId, sheet_name: s.sheet_name, seq: s.seq, display_order: i,
        street: s.street, postal_code: s.postal_code, city: s.city, cod_amount: s.cod_amount, payment_method: s.payment_method,
        time_window: s.time_window, planned_time: s.planned_time, note: s.note, weight: s.weight, phone: s.phone,
        is_cash: s.is_cash, expected_amount: s.expected_amount,
      }))
      const { error: sErr } = await supabase.from('route_stops').insert(rows)
      if (sErr) throw sErr
      setMsg(`${stops.length} stop importálva ide: ${cars?.find((c) => c.id === carId)?.plate} / ${formatDate(date)}`)
      await qc.invalidateQueries({ queryKey: ['mgr-uploads'] })
    } catch (e) {
      setMsg('Hiba: ' + (e instanceof Error ? e.message : 'ismeretlen'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <h2>Fuvarterv feltöltés — {currentWorkspace?.name}</h2>
      <div className="card stack">
        <p className="small muted">Tölts fel egy crew Excelt egy adott autóhoz és naphoz. A sofőr a saját eszközén látja majd.</p>
        <div className="grid-2">
          <div className="field">
            <label>Autó</label>
            <select className="select" value={carId} onChange={(e) => setCarId(e.target.value)}>
              <option value="">— válassz —</option>
              {cars?.map((c) => <option key={c.id} value={c.id}>{c.plate}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Dátum</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field"><label>Kezdő POI</label><input className="input" value={startPoi} onChange={(e) => setStartPoi(e.target.value)} placeholder="depó címe" /></div>
        <div className="field"><label>Vég POI</label><input className="input" value={endPoi} onChange={(e) => setEndPoi(e.target.value)} placeholder="depó címe" /></div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }} />
        {msg && <div className={`alert ${msg.startsWith('Hiba') ? 'error' : 'success'}`}>{msg}</div>}
        <button className="btn" disabled={busy || !carId} onClick={() => fileRef.current?.click()}>{busy ? 'Feldolgozás…' : '📄 Excel kiválasztása'}</button>
      </div>

      {(uploads?.length ?? 0) > 0 && (
        <div className="card stack">
          <div className="card-title">Feltöltött fuvartervek</div>
          {uploads!.map((u) => (
            <div key={u.id} className="between">
              <span className="small">{(u.car as unknown as { plate: string } | null)?.plate ?? '—'} · {formatDate(u.work_date)}</span>
              <span className="tiny muted">{u.file_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
