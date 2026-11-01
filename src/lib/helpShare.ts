import { useSyncExternalStore } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

// „Segítséget kérek” mód (futár oldal): az app a SAJÁT felületét tükrözi a vezetőnek egy Realtime
// csatornán (nem videó, nem képernyőfelvétel — a megjelenített oldal tartalma), másodpercenként,
// csak változáskor. A jelszómezők kitakarva, kamera/rajz helyén jelölő. A vezető rámutathat egy
// pontra és üzenhet; a futár bármikor leállítja. Pillanatkép 15 mp-enként az adatbázisba is kerül,
// hogy a vezető később is lássa, hol akadt el.

export type HelpFrame = { html: string; w: number; h: number; path: string; scroll: number; htmlAttrs: string; bodyAttrs: string; at: number }
export type HelpPointer = { x: number; y: number; at: number }
export type HelpState = {
  active: boolean
  sessionId: string | null
  watching: boolean // a vezető épp nézi
  pointer: HelpPointer | null
  message: { text: string; at: number } | null
  error: string | null
}

let state: HelpState = { active: false, sessionId: null, watching: false, pointer: null, message: null, error: null }
const listeners = new Set<() => void>()
function set(patch: Partial<HelpState>) { state = { ...state, ...patch }; listeners.forEach((l) => l()) }
export function useHelpShare(): HelpState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => state, () => state)
}

let channel: RealtimeChannel | null = null
let frameTimer: number | null = null
let snapshotTimer: number | null = null
let lastSig = ''
let lastSentAt = 0
let pointerTimer: number | null = null
let messageTimer: number | null = null

const attrsOf = (el: Element) => Array.from(el.attributes).filter((a) => !a.name.startsWith('on')).map((a) => `${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join(' ')

// A felület pillanatképe: a #root tartalma, az űrlapok aktuális értékével, veszélyes részek nélkül
export function captureFrame(): HelpFrame | null {
  const root = document.getElementById('root')
  if (!root) return null
  const clone = root.cloneNode(true) as HTMLElement
  const liveFields = root.querySelectorAll('input, textarea, select')
  const cloneFields = clone.querySelectorAll('input, textarea, select')
  liveFields.forEach((el, i) => {
    const c = cloneFields[i]
    if (!c) return
    if (el instanceof HTMLInputElement) {
      if (el.type === 'password') c.setAttribute('value', '••••••')
      else if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked') }
      else if (el.type !== 'file') c.setAttribute('value', el.value)
    } else if (el instanceof HTMLTextAreaElement) {
      c.textContent = el.value
    } else if (el instanceof HTMLSelectElement) {
      c.querySelectorAll('option').forEach((o, k) => { if (k === el.selectedIndex) o.setAttribute('selected', ''); else o.removeAttribute('selected') })
    }
  })
  clone.querySelectorAll('script, iframe, object, embed').forEach((n) => n.remove())
  clone.querySelectorAll('[data-help-ui]').forEach((n) => n.remove())
  clone.querySelectorAll('video, canvas').forEach((v) => {
    const d = document.createElement('div')
    d.style.cssText = 'background:#1f2937;color:#e5e7eb;padding:16px;text-align:center;border-radius:12px;font-size:13px'
    d.textContent = '[kamera / élő kép]'
    v.replaceWith(d)
  })
  clone.querySelectorAll('*').forEach((el) => { for (const a of Array.from(el.attributes)) if (a.name.startsWith('on')) el.removeAttribute(a.name) })
  return {
    html: clone.innerHTML, w: window.innerWidth, h: window.innerHeight, path: location.pathname + location.search,
    scroll: window.scrollY, htmlAttrs: attrsOf(document.documentElement), bodyAttrs: attrsOf(document.body), at: Date.now(),
  }
}

async function tick() {
  if (!channel || !state.sessionId) return
  const f = captureFrame()
  if (!f) return
  if (f.html.length > 900_000) f.html = f.html.slice(0, 900_000) + '<div style="padding:12px;color:#f87171">[a nézet túl nagy — levágva]</div>'
  const sig = `${f.path}|${f.scroll}|${f.w}x${f.h}|${f.html.length}|${f.html.slice(0, 200)}|${f.html.slice(-200)}`
  const now = Date.now()
  if (sig === lastSig && now - lastSentAt < 5000) return // nincs változás: 5 mp-enként egy életjel
  lastSig = sig; lastSentAt = now
  try { await channel.send({ type: 'broadcast', event: 'frame', payload: f }) } catch { /* következő körben újra */ }
}

async function snapshot() {
  if (!state.sessionId) return
  const f = captureFrame()
  if (!f) return
  await supabase.from('help_sessions').update({
    snapshot_html: f.html.slice(0, 900_000), path: f.path, viewport_w: f.w, viewport_h: f.h, html_attrs: f.htmlAttrs, body_attrs: f.bodyAttrs, last_seen_at: new Date().toISOString(),
  }).eq('id', state.sessionId)
}

export async function startHelpShare(workspaceId: string, userId: string, note: string | null): Promise<void> {
  if (state.active) return
  set({ error: null })
  // korábbi, lezáratlan saját kérés lezárása
  await supabase.from('help_sessions').update({ ended_at: new Date().toISOString() }).eq('user_id', userId).is('ended_at', null)
  const f = captureFrame()
  const { data, error } = await supabase.from('help_sessions').insert({
    workspace_id: workspaceId, user_id: userId, note: note?.trim() || null, path: location.pathname,
    snapshot_html: f?.html.slice(0, 900_000) ?? null, viewport_w: f?.w ?? null, viewport_h: f?.h ?? null, html_attrs: f?.htmlAttrs ?? null, body_attrs: f?.bodyAttrs ?? null,
  }).select('id').single()
  if (error || !data) { set({ error: (error as { message?: string } | null)?.message ?? 'A segítségkérés nem indult el' }); throw error ?? new Error('insert failed') }
  const id = data.id as string
  channel = supabase.channel(`help:${id}`, { config: { broadcast: { self: false } } })
  channel
    .on('broadcast', { event: 'hello' }, () => { set({ watching: true }); lastSig = ''; void tick() })
    .on('broadcast', { event: 'bye' }, () => set({ watching: false }))
    .on('broadcast', { event: 'pointer' }, ({ payload }) => {
      const p = payload as { x: number; y: number }
      set({ pointer: { x: p.x, y: p.y, at: Date.now() }, watching: true })
      if (pointerTimer) window.clearTimeout(pointerTimer)
      pointerTimer = window.setTimeout(() => set({ pointer: null }), 4000)
    })
    .on('broadcast', { event: 'msg' }, ({ payload }) => {
      const m = payload as { text: string }
      set({ message: { text: String(m.text ?? '').slice(0, 300), at: Date.now() }, watching: true })
      if (messageTimer) window.clearTimeout(messageTimer)
      messageTimer = window.setTimeout(() => set({ message: null }), 12000)
      try { navigator.vibrate?.([60, 40, 60]) } catch { /* nincs rezgés */ }
    })
    .on('broadcast', { event: 'end' }, () => { void stopHelpShare(false) })
    .subscribe((status) => { if (status === 'SUBSCRIBED') { lastSig = ''; void tick() } })
  set({ active: true, sessionId: id, watching: false, pointer: null, message: null })
  frameTimer = window.setInterval(() => void tick(), 1000)
  snapshotTimer = window.setInterval(() => void snapshot(), 15000)
  window.addEventListener('pagehide', onPageHide)
}

function onPageHide() { void stopHelpShare(true) }

export async function stopHelpShare(markEnded = true): Promise<void> {
  const id = state.sessionId
  if (frameTimer) { window.clearInterval(frameTimer); frameTimer = null }
  if (snapshotTimer) { window.clearInterval(snapshotTimer); snapshotTimer = null }
  window.removeEventListener('pagehide', onPageHide)
  if (channel) { try { await channel.send({ type: 'broadcast', event: 'ended', payload: {} }) } catch { /* már zárva */ } void supabase.removeChannel(channel); channel = null }
  set({ active: false, sessionId: null, watching: false, pointer: null, message: null })
  if (id && markEnded) await supabase.from('help_sessions').update({ ended_at: new Date().toISOString() }).eq('id', id)
}
