import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { supabase } from './supabase'
import { uploadPhoto, recordPhotoProof } from './photos'
import type { Database } from './database.types'

type TableName = keyof Database['public']['Tables']

// ---- Offline sorbaállítás (outbox) ----
// A pénz- és fotó-bejegyzések gyenge térerőnél is rögzíthetők; itt tárolódnak és
// online állapotban automatikusan szinkronizálódnak.

export interface OutboxPhoto {
  workspaceId: string
  folder: string
  id: string
  column: string // melyik oszlopba kerüljön a feltöltött storage path
  blob: Blob
}

export interface OutboxRecord {
  id: string // kliens-oldali UUID = idempotencia kulcs
  table: string
  op: 'insert' | 'update'
  values: Record<string, unknown>
  match?: Record<string, unknown>
  photo?: OutboxPhoto
  label: string // emberi címke a UI-hoz
  attempts: number
  createdAt: number
  seq?: number // sorrend azonos createdAt esetén (pl. ellenőrzés + fotói)
  lastError?: string // utolsó nem-hálózati hiba üzenete
}

// Ennyi nem-hálózati hiba után a tétel "parkolóba" kerül: nem próbáljuk újra,
// de NEM töröljük — a szinkron-jelvény hibaként mutatja.
export const MAX_ATTEMPTS = 5

interface AlzaDB extends DBSchema {
  outbox: { key: string; value: OutboxRecord }
}

let _db: Promise<IDBPDatabase<AlzaDB>> | null = null
function db() {
  if (!_db) {
    _db = openDB<AlzaDB>('alza-outbox', 1, {
      upgrade(d) {
        d.createObjectStore('outbox', { keyPath: 'id' })
      },
    })
  }
  return _db
}

let seqCounter = 0

async function putRecord(rec: OutboxRecord): Promise<void> {
  const d = await db()
  try {
    await d.put('outbox', rec)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      throw new Error('Nincs elég tárhely az eszközön a mentéshez — szabadíts fel helyet, és próbáld újra')
    }
    throw e
  }
}

export async function enqueue(rec: Omit<OutboxRecord, 'attempts' | 'createdAt'>): Promise<void> {
  await putRecord({ ...rec, attempts: 0, createdAt: Date.now(), seq: seqCounter++ })
  notify()
}

export interface OutboxCounts {
  pending: number // szinkronra váró tételek
  failed: number // parkolt (túl sokszor hibázott) tételek
}

export async function outboxCounts(): Promise<OutboxCounts> {
  const all = await (await db()).getAll('outbox')
  const failed = all.filter((r) => r.attempts >= MAX_ATTEMPTS).length
  return { pending: all.length - failed, failed }
}

// Parkolt tételek listája / újrapróbálása / eldobása (a jelvény mögötti kezelőfelülethez)
export async function listFailed(): Promise<OutboxRecord[]> {
  const all = await (await db()).getAll('outbox')
  return all.filter((r) => r.attempts >= MAX_ATTEMPTS).sort((a, b) => a.createdAt - b.createdAt)
}

export async function retryFailed(id: string): Promise<void> {
  const d = await db()
  const rec = await d.get('outbox', id)
  if (rec) {
    rec.attempts = 0
    rec.lastError = undefined
    await d.put('outbox', rec)
    notify()
    void flushOutbox()
  }
}

export async function discardFailed(id: string): Promise<void> {
  await (await db()).delete('outbox', id)
  notify()
}

function isNetworkError(e: unknown): boolean {
  if (!navigator.onLine) return true
  // A fetch hálózati hibái TypeError-ként érkeznek; a szöveges minták csak tartalék
  if (e instanceof TypeError) return true
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed')
    || msg.includes('timeout') || msg.includes('load failed')
}

async function runRecord(rec: OutboxRecord): Promise<void> {
  const values = { ...rec.values }
  if (rec.photo) {
    const path = await uploadPhoto(rec.photo.workspaceId, rec.photo.folder, rec.photo.id, rec.photo.blob)
    values[rec.photo.column] = path
    // Fotó-hitelesség: hash rögzítése (hiba esetén nem blokkolja a mentést)
    try {
      await recordPhotoProof(rec.photo.workspaceId, path, rec.photo.blob)
    } catch (e) {
      console.error('Fotó-hash rögzítési hiba:', e)
    }
  }
  if (rec.op === 'insert') {
    // upsert -> idempotens ismételt lejátszáskor (a PK id megegyezik)
    const { error } = await supabase.from(rec.table as TableName).upsert(values as never)
    if (error) throw error
  } else {
    let q = supabase.from(rec.table as TableName).update(values as never)
    for (const [k, v] of Object.entries(rec.match ?? {})) q = q.eq(k as never, v as never)
    const { error } = await q
    if (error) throw error
  }
}

let flushing = false

export async function flushOutbox(): Promise<{ done: number; remaining: number }> {
  if (flushing) return { done: 0, remaining: (await outboxCounts()).pending }
  // Több fül/PWA-ablak esetén csak egy flush fusson egyszerre
  if ('locks' in navigator) {
    const result = await navigator.locks.request('alza-outbox-flush', { ifAvailable: true }, async (lock) => {
      if (!lock) return null
      return doFlush()
    })
    return result ?? { done: 0, remaining: (await outboxCounts()).pending }
  }
  return doFlush()
}

async function doFlush(): Promise<{ done: number; remaining: number }> {
  flushing = true
  let done = 0
  try {
    const d = await db()
    const all = (await d.getAll('outbox'))
      .sort((a, b) => a.createdAt - b.createdAt || (a.seq ?? 0) - (b.seq ?? 0))
    // Ha egy szülő-rekord hibázik, a rá hivatkozó gyerekeket ebben a körben kihagyjuk,
    // hogy ne égessék el a próbálkozásaikat garantált FK-hibákra.
    const failedIds = new Set<string>()
    for (const rec of all) {
      if (rec.attempts >= MAX_ATTEMPTS) {
        failedIds.add(rec.id)
        continue // parkolt tétel: nem próbáljuk újra
      }
      const refsFailed = Object.values(rec.values).some((v) => typeof v === 'string' && failedIds.has(v))
      if (refsFailed) continue
      try {
        await runRecord(rec)
        await d.delete('outbox', rec.id)
        done++
      } catch (e) {
        if (isNetworkError(e)) break // hálózati hiba: később újrapróbáljuk
        // adat/RLS hiba: számoljuk, és MAX_ATTEMPTS után parkoljuk (nem töröljük!)
        rec.attempts += 1
        rec.lastError = e instanceof Error ? e.message : String(e)
        failedIds.add(rec.id)
        if (rec.attempts >= MAX_ATTEMPTS) console.error('Outbox elem parkolva (túl sok hiba):', rec.label, e)
        await d.put('outbox', rec)
      }
    }
  } finally {
    flushing = false
    notify()
  }
  const counts = await outboxCounts()
  return { done, remaining: counts.pending }
}

// ---- egyszerű pub/sub a UI-badge frissítéséhez ----
type Listener = () => void
const listeners = new Set<Listener>()
export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify() {
  listeners.forEach((l) => l())
}

// Mentés: ELŐBB a helyi sorba kerül (így app-bezárás/összeomlás sem veszíti el),
// majd azonnal megpróbáljuk beküldeni. Visszaadja: queued?
export async function submitNow(
  rec: Omit<OutboxRecord, 'attempts' | 'createdAt'>,
): Promise<{ queued: boolean }> {
  const stored: OutboxRecord = { ...rec, attempts: 0, createdAt: Date.now(), seq: seqCounter++ }
  await putRecord(stored)
  if (!navigator.onLine) {
    notify()
    return { queued: true }
  }
  try {
    await runRecord(stored)
    await (await db()).delete('outbox', stored.id)
    notify()
    return { queued: false }
  } catch (e) {
    if (isNetworkError(e)) {
      notify()
      return { queued: true }
    }
    // valódi adat-hiba (pl. RLS): a hívó kezeli — ne ragadjon a sorban
    await (await db()).delete('outbox', stored.id)
    notify()
    throw e
  }
}
