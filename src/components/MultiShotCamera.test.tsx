// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// a kamera nem indul (pl. megtagadott engedély) — a feltöltésnek ettől függetlenül működnie kell
vi.mock('../lib/camera', () => ({ getCameraStream: () => Promise.reject(new Error('nincs kamera')) }))
const importFile = vi.fn()
vi.mock('../lib/mediaImport', () => ({ importFile: (f: File) => importFile(f), MAX_UPLOAD_MB: 50 }))

import MultiShotCamera from './MultiShotCamera'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined

beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  importFile.mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:elonezet'); URL.revokeObjectURL = vi.fn()
})
afterEach(() => { act(() => root.unmount()); host.remove() })

async function pick(files: File[]) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  await settle()
}

describe('MultiShotCamera — feltöltés a telefonról', () => {
  it('csak kérésre van feltöltés gomb', async () => {
    await act(async () => { root.render(<MultiShotCamera title="Takarítás" onSend={() => undefined} onCancel={() => undefined} />) })
    expect(host.querySelector('input[type="file"]')).toBeNull()
  })

  it('több kép és videó egyszerre: a sorba kerülnek, a Mentés mindet átadja (videónál a bélyegképpel) — kamera nélkül is', async () => {
    const onSend = vi.fn()
    await act(async () => { root.render(<MultiShotCamera video upload title="Elszámolás" sendLabel="Mentés" onSend={onSend} onCancel={() => undefined} />) })
    await settle()
    expect(host.textContent).toContain('Nem sikerült elindítani a kamerát')
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(input.multiple).toBe(true)
    expect(input.accept).toBe('image/*,video/*')
    expect(button('Feltöltés a telefonról')!.disabled).toBe(false)

    const img1 = new Blob(['a'], { type: 'image/jpeg' }), img2 = new Blob(['b'], { type: 'image/jpeg' })
    const vid = new Blob(['v'], { type: 'video/mp4' }), poster = new Blob(['p'], { type: 'image/jpeg' })
    importFile
      .mockResolvedValueOnce({ blob: img1, video: false })
      .mockResolvedValueOnce({ blob: img2, video: false })
      .mockResolvedValueOnce({ blob: vid, video: true, poster, seconds: 12 })
    await pick([new File(['a'], '1.jpg'), new File(['b'], '2.jpg'), new File(['v'], 'v.mp4')])

    expect(host.querySelector('.camera-head')!.textContent).toContain('2 kép, 1 videó')
    expect(host.textContent).toContain('▶ 0:12')
    const send = button('Mentés (3)')!
    expect(send.disabled).toBe(false)
    await act(async () => { send.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onSend).toHaveBeenCalledWith([img1, img2, vid], [undefined, undefined, poster])
  })

  it('a nem feltölthető fájl kimarad, és kiírja, miért — a többi megy', async () => {
    await act(async () => { root.render(<MultiShotCamera video upload title="Elszámolás" sendLabel="Mentés" onSend={() => undefined} onCancel={() => undefined} />) })
    importFile
      .mockResolvedValueOnce({ error: 'nagy.mp4: túl nagy videó (120 MB) — legfeljebb 50 MB tölthető fel.' })
      .mockResolvedValueOnce({ blob: new Blob(['a'], { type: 'image/jpeg' }), video: false })
    await pick([new File(['x'], 'nagy.mp4'), new File(['a'], '1.jpg')])
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('túl nagy videó (120 MB)')
    expect(button('Mentés (1)')).toBeTruthy()
  })
})
