import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAuth } from '../context/AuthContext'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { resolveNames } from '../lib/names'
import { formatDateTime } from '../lib/labels'
import { errMsg } from '../lib/errors'
import type { HelpFrame } from '../lib/helpShare'
import Icon from '../components/Icon'

// Élő nézet (vezető): a futár felületének tükre. A futár a saját oldalát küldi (Realtime),
// itt egy szkript nélküli, azonos stílusú keretben jelenik meg. Rámutatás: koppintás a képen;
// üzenet: szöveg a futár képernyőjére. Lezárt kérésnél az utolsó pillanatkép látszik.
type Session = { id: string; user_id: string; started_at: string; last_seen_at: string; ended_at: string | null; path: string | null; note: string | null; snapshot_html: string | null; viewport_w: number | null; viewport_h: number | null; html_attrs: string | null; body_attrs: string | null }

function useSessions(active: boolean) {
  const { currentWorkspaceId } = useWorkspace()
  const { profile } = useAuth()
  useRealtimeInvalidate(currentWorkspaceId, ['help_sessions'], [['help-sessions']])
  return useQuery({
    queryKey: ['help-sessions', currentWorkspaceId, active ? 'list-active' : 'list-ended'],
    enabled: !!currentWorkspaceId,
    refetchInterval: active ? 15000 : false,
    queryFn: async () => {
      let q = supabase.from('help_sessions').select('id, user_id, started_at, last_seen_at, ended_at, path, note').eq('workspace_id', currentWorkspaceId!).order('started_at', { ascending: false })
      q = active ? q.is('ended_at', null).gt('last_seen_at', new Date(Date.now() - 90_000).toISOString()) : q.not('ended_at', 'is', null).limit(20)
      const { data, error } = await q
      if (error) throw error
      const names = await resolveNames((data ?? []).map((r) => r.user_id))
      return (data ?? []).filter((r) => r.user_id !== profile?.id).map((r) => ({ ...r, name: names[r.user_id] ?? '?' }))
    },
  })
}

export default function LiveView() {
  const { id } = useParams()
  if (id) return <Viewer id={id} />
  return <SessionList />
}

function SessionList() {
  const { data: active } = useSessions(true)
  const { data: ended } = useSessions(false)
  return (
    <div className="stack">
      <h2>Élő nézet</h2>
      <p className="small muted" style={{ margin: 0 }}>A futár (vagy egy vezető) a kezdőlapon az „Elakadtam — segítséget kérek” gombbal indítja; a vezetők kérését az adminok kapják. Amíg fut, itt látod, amit ő lát, rá tudsz mutatni egy gombra, és üzenhetsz neki. A lezárt kérésnél az utolsó pillanatkép marad meg (30 napig).</p>
      <div className="card stack" style={{ gap: 6 }}>
        <div className="card-title" style={{ margin: 0 }}><Icon name="life-buoy" />Most kér segítséget ({active?.length ?? 0})</div>
        {(active ?? []).length === 0 && <div className="tiny muted">Jelenleg senki.</div>}
        {(active ?? []).map((r) => (
          <Link key={r.id} to={`/elo-nezet/${r.id}`} className="between" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="small"><strong>{r.name}</strong>{r.note ? ` — ${r.note}` : ''} <span className="muted">· {r.path} · {formatDateTime(r.started_at)}</span></span>
            <span className="badge warning">Megnyitás</span>
          </Link>
        ))}
      </div>
      <div className="card stack" style={{ gap: 6 }}>
        <div className="card-title" style={{ margin: 0 }}><Icon name="history" />Korábbi kérések</div>
        {(ended ?? []).length === 0 && <div className="tiny muted">Még nem volt.</div>}
        {(ended ?? []).map((r) => (
          <Link key={r.id} to={`/elo-nezet/${r.id}`} className="between" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="small">{r.name}{r.note ? ` — ${r.note}` : ''} <span className="muted">· {r.path} · {formatDateTime(r.started_at)}</span></span>
            <span className="badge">Pillanatkép</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function Viewer({ id }: { id: string }) {
  const qc = useQueryClient()
  const { data: session, error: loadErr } = useQuery({
    queryKey: ['help-session', id],
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await supabase.from('help_sessions').select('*').eq('id', id).maybeSingle()
      if (error) throw error
      if (!data) throw new Error('A kérés nem található')
      const names = await resolveNames([data.user_id])
      return { ...(data as Session), name: names[data.user_id] ?? '?' }
    },
  })
  const [frame, setFrame] = useState<HelpFrame | null>(null)
  const [live, setLive] = useState(false)
  const [msg, setMsg] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const ended = !!session?.ended_at || (!!session && Date.now() - new Date(session.last_seen_at).getTime() > 90_000)

  // Csatorna: a futár kockái; belépéskor „hello” (nála „a vezető nézi” lesz)
  useEffect(() => {
    if (!session || ended) return
    const ch = supabase.channel(`help:${id}`, { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: 'frame' }, ({ payload }) => { setFrame(payload as HelpFrame); setLive(true) })
      .on('broadcast', { event: 'ended' }, () => { setLive(false); void qc.invalidateQueries({ queryKey: ['help-session', id] }) })
      .subscribe((status) => { if (status === 'SUBSCRIBED') void ch.send({ type: 'broadcast', event: 'hello', payload: {} }) })
    channelRef.current = ch
    return () => { void ch.send({ type: 'broadcast', event: 'bye', payload: {} }).catch(() => undefined); void supabase.removeChannel(ch); channelRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!session, ended])

  // Megjelenítés: azonos stíluslapok (ugyanaz a build), szkript nélkül, a futár nézet-méretében
  const shown: HelpFrame | null = frame ?? (session?.snapshot_html ? { html: session.snapshot_html, w: session.viewport_w ?? 390, h: session.viewport_h ?? 760, path: session.path ?? '/', scroll: 0, htmlAttrs: session.html_attrs ?? '', bodyAttrs: session.body_attrs ?? '', at: new Date(session.last_seen_at).getTime() } : null)
  useEffect(() => {
    const ifr = iframeRef.current
    if (!ifr || !shown) return
    const doc = ifr.contentDocument
    if (!doc) return
    if (!doc.getElementById('root')) {
      const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((n) => n.outerHTML).join('')
      doc.open()
      doc.write(`<!doctype html><html ${shown.htmlAttrs}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${styles}<style>html,body{margin:0} .camera-overlay{position:static!important}</style></head><body ${shown.bodyAttrs}><div id="root"></div></body></html>`)
      doc.close()
    } else {
      // attribútumok (téma) frissítése
      const html = doc.documentElement
      for (const m of shown.htmlAttrs.matchAll(/([\w-]+)="([^"]*)"/g)) html.setAttribute(m[1], m[2].replace(/&quot;/g, '"'))
    }
    const root = doc.getElementById('root')
    if (root) root.innerHTML = shown.html
    doc.documentElement.scrollTop = shown.scroll
    doc.body.scrollTop = shown.scroll
  }, [shown])
  useEffect(() => {
    const el = boxRef.current
    if (!el || !shown) return
    const fit = () => setScale(Math.min(1, el.clientWidth / Math.max(320, shown.w)))
    fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit)
  }, [shown])

  const point = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!channelRef.current || !shown || !live) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.round((e.clientX - r.left) / scale), y = Math.round((e.clientY - r.top) / scale)
    void channelRef.current.send({ type: 'broadcast', event: 'pointer', payload: { x, y } })
  }
  const send = async () => {
    if (!channelRef.current || !msg.trim()) return
    await channelRef.current.send({ type: 'broadcast', event: 'msg', payload: { text: msg.trim().slice(0, 300) } })
    setSent(msg.trim()); setMsg('')
  }
  const endSession = async () => {
    try { await channelRef.current?.send({ type: 'broadcast', event: 'end', payload: {} }) } catch { /* már zárva */ }
    await supabase.from('help_sessions').update({ ended_at: new Date().toISOString() }).eq('id', id)
    void qc.invalidateQueries({ queryKey: ['help-session', id] }); void qc.invalidateQueries({ queryKey: ['help-sessions'] })
  }

  if (loadErr) return <div className="stack"><h2>Élő nézet</h2><div className="alert error">{errMsg(loadErr, 'Nem sikerült betölteni')}</div><Link to="/elo-nezet" className="btn ghost sm auto">Vissza a listához</Link></div>
  if (!session) return <div className="card"><div className="spinner" /></div>
  return (
    <div className="stack">
      <div className="between">
        <h2 style={{ margin: 0 }}>{session.name}</h2>
        <Link to="/elo-nezet" className="btn ghost sm auto"><Icon name="arrow-left" size={14} />Lista</Link>
      </div>
      <div className="card stack" style={{ gap: 6, borderColor: live ? 'var(--success)' : ended ? 'var(--border)' : 'var(--warning)' }}>
        <div className="between">
          <span className="small">
            {live ? <span className="badge success"><Icon name="eye" size={12} />Élő</span> : ended ? <span className="badge">Lezárva · utolsó pillanatkép</span> : <span className="badge warning">Kapcsolódás…</span>}
            {' '}<span className="muted">{session.note ? `„${session.note}” · ` : ''}oldal: {shown?.path ?? session.path} · {formatDateTime(session.started_at)}</span>
          </span>
          {!ended && <button type="button" className="btn ghost sm auto" onClick={() => void endSession()}>Lezárás</button>}
        </div>
        {!ended && (
          <div className="row" style={{ gap: 6 }}>
            <input className="input" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Üzenet a futár képernyőjére…" maxLength={300} onKeyDown={(e) => { if (e.key === 'Enter') void send() }} />
            <button type="button" className="btn sm auto" disabled={!live || !msg.trim()} onClick={() => void send()}><Icon name="send" size={14} />Küldés</button>
          </div>
        )}
        {sent && <div className="tiny muted">Elküldve: „{sent}”</div>}
        {live && <div className="tiny muted">Koppints a képre: a futárnál ott villan egy kör („ide koppints”).</div>}
      </div>
      {!shown ? <div className="card tiny muted">Még nincs kép — a futár telefonja küldi az elsőt pár másodpercen belül.</div> : (
        <div ref={boxRef} style={{ width: '100%', overflow: 'hidden' }}>
          <div style={{ width: shown.w * scale, height: shown.h * scale, position: 'relative', margin: '0 auto', border: '6px solid #111', borderRadius: 24, overflow: 'hidden', background: '#000' }}>
            <iframe ref={iframeRef} title="Futár nézete" sandbox="allow-same-origin" style={{ width: shown.w, height: shown.h, border: 'none', transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none', background: '#fff' }} />
            <div onClick={point} style={{ position: 'absolute', inset: 0, cursor: live ? 'crosshair' : 'default' }} />
          </div>
          <div className="tiny muted" style={{ textAlign: 'center', marginTop: 4 }}>{shown.w}×{shown.h} · frissült {new Date(shown.at).toLocaleTimeString('hu-HU')}</div>
        </div>
      )}
    </div>
  )
}
