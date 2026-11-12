// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { BoxStop } from '../lib/boxSheet'

const invoke = vi.fn()
const inserted: string[] = []
const logged: { text: string; text_key: string }[] = []

vi.mock('../lib/supabase', () => {
  const chain = (result: unknown) => {
    const p: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'in', 'is']) p[m] = () => p
    p.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok)
    return p
  }
  return {
    supabase: {
      from: (table: string) => ({
        select: () => chain({ data: [], error: null }),
        insert: (row: { storage_path: string } | { text: string; text_key: string }[]) => {
          if (table === 'box_unmapped_messages') logged.push(...(row as { text: string; text_key: string }[]))
          else inserted.push((row as { storage_path: string }).storage_path)
          return Promise.resolve({ error: null })
        },
        update: () => chain({ error: null }),
      }),
      functions: { invoke: (...a: unknown[]) => invoke(...a) },
    },
  }
})
vi.mock('../context/WorkspaceContext', () => ({ useWorkspace: () => ({ currentWorkspaceId: 'ws-1' }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u-1' } }) }))
vi.mock('../lib/photos', () => ({
  uploadPhoto: (_ws: string, folder: string, id: string) => Promise.resolve(`ws-1/${folder}/${id}.jpg`),
  recordPhotoProof: () => Promise.resolve(),
  signedUrl: () => Promise.resolve(null),
}))
// A feltöltés a helyi soron át megy (gyenge netnél sorba áll) — a tesztben közvetlenül „felmegy”
vi.mock('../lib/outbox', async () => {
  const photos = await import('../lib/photos')
  const { supabase } = await import('../lib/supabase')
  return {
    submitNow: async (rec: { table: string; values: Record<string, unknown>; photo?: { workspaceId: string; folder: string; id: string; column: string; blob: Blob } }) => {
      const values = { ...rec.values }
      if (rec.photo) values[rec.photo.column] = await photos.uploadPhoto(rec.photo.workspaceId, rec.photo.folder, rec.photo.id, rec.photo.blob)
      await supabase.from(rec.table as never).insert(values as never)
      return { queued: false }
    },
  }
})
vi.mock('../lib/toast', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('./PhotoThumb', () => ({ default: () => null }))
// A kamera helyett egy gomb: megnyomva „elkészül” a kép
vi.mock('./CameraCapture', () => ({
  default: ({ title, onCapture }: { title: string; onCapture: (b: Blob, url: string) => void }) => (
    <button data-testid="camera" data-title={title} onClick={() => onCapture(new Blob(['x']), 'blob:kep')}>exponál</button>
  ),
}))

import StopPhotos from './StopPhotos'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const onPatch = vi.fn()
const stop = { id: 'stop-1', box_code: 'AB1234', box_name: 'Teszt box', note: null, placed: 0, missorted: 0, nf: 0, oversize: 0, shortage: 0, returned: 0, damaged: 0, left_on_car: 0 } as unknown as BoxStop

const camera = () => host.querySelector<HTMLButtonElement>('[data-testid="camera"]')
const addTile = () => host.querySelector<HTMLButtonElement>('button.thumb-empty')
const shots = () => host.querySelectorAll('img.thumb').length
const click = (el: Element | null) => act(async () => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })

beforeEach(async () => {
  invoke.mockReset(); onPatch.mockReset(); inserted.length = 0; logged.length = 0
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    root.render(<QueryClientProvider client={qc}><StopPhotos stop={stop} boxLabel="AB1234 · Teszt box" courierName="Teszt Elek" onPatch={onPatch} /></QueryClientProvider>)
  })
  await settle()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

async function takePhoto() {
  await click(addTile())
  expect(camera()).not.toBeNull() // EGY koppintás után már a kamera látszik
  await click(camera())
}

describe('StopPhotos', () => {
  it('az első fotó egy koppintásra nyitja a kamerát', async () => {
    expect(addTile()!.textContent).toContain('Kijelző')
    await click(addTile())
    expect(camera()!.dataset.title).toBe('Kijelző')
    await click(camera())
    expect(camera()).toBeNull()
    expect(shots()).toBe(1)
  })

  it('a „még egy fotó” azonnal a kamerát nyitja, nem üres helyet ad', async () => {
    await takePhoto()
    expect(addTile()!.textContent).toContain('még egy fotó')
    await click(addTile())
    expect(camera()!.dataset.title).toBe('2. fotó')
    expect(shots()).toBe(1) // nincs üres hely a rácsban
    await click(camera())
    expect(shots()).toBe(2)
  })

  it('négynél több fotó is készíthető, a keretnél eltűnik a gomb', async () => {
    for (let i = 0; i < 6; i++) await takePhoto()
    expect(shots()).toBe(6)
    expect(addTile()).not.toBeNull()
    for (let i = 0; i < 6; i++) await takePhoto()
    expect(shots()).toBe(12)
    expect(addTile()).toBeNull()
  })

  it('a kiolvasás minden (legfeljebb 8) képet elküld, és beírja a számokat', async () => {
    invoke.mockResolvedValue({ data: { result: { placed: 35, shortage: 3, do_not_place: 3, nf: null, codes: [] } }, error: null })
    for (let i = 0; i < 6; i++) await takePhoto()
    const readBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Kiolvasás'))
    await click(readBtn!)
    await settle()
    expect(inserted).toHaveLength(6)
    const [name, opts] = invoke.mock.calls[0] as [string, { body: { paths: string[] } }]
    expect(name).toBe('read-box-photo')
    expect(opts.body.paths).toEqual(inserted)
    expect(onPatch).toHaveBeenCalledWith({ placed: 35, shortage: 3, do_not_place: 3 })
    // újbóli kiolvasásnál nem töltődnek fel még egyszer a képek
    await click(readBtn!)
    await settle()
    expect(inserted).toHaveLength(6)
  })

  it('a mezőhöz nem sorolható kijelző-üzenet a megjegyzésbe és az admin naplójába kerül', async () => {
    invoke.mockResolvedValue({ data: { result: { placed: 12, codes: [], unmapped: ['A fiók nem nyílik', 'a fiók nem nyílik', ''] } }, error: null })
    await takePhoto()
    const readBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Kiolvasás'))
    await click(readBtn!)
    await settle()
    expect(onPatch).toHaveBeenCalledWith({ placed: 12, note: 'Kijelző: A fiók nem nyílik' })
    expect(logged).toEqual([{ text: 'A fiók nem nyílik', text_key: 'a fiok nem nyilik', workspace_id: 'ws-1', stop_id: 'stop-1', box_code: 'AB1234', created_by: 'u-1' }])
    expect(host.textContent).toContain('Kijelző-üzenet a megjegyzésbe írva: A fiók nem nyílik')
  })
})
