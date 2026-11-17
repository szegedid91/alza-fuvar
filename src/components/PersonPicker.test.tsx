// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import PersonPicker from './PersonPicker'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const OPTIONS = [{ id: 'a', label: 'Árvai Anna' }, { id: 'b', label: 'Bodó Béla' }, { id: 'c', label: 'Cseh Cili' }]

let host: HTMLDivElement
let root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

function setup(props: Partial<Parameters<typeof PersonPicker>[0]> = {}) {
  const onChange = vi.fn()
  const onNav = vi.fn((_dir: 'next' | 'prev' | 'down') => true)
  act(() => root.render(<PersonPicker value="" options={OPTIONS} placeholder="— sofőr —" onChange={onChange} onNav={onNav} inputData={{ 'data-wk': 'x|0|1|driver_id' }} {...props} />))
  const input = host.querySelector('input')!
  const type = (text: string) => act(() => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const key = (k: string, shiftKey = false) => {
    const ev = new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true })
    act(() => { input.dispatchEvent(ev) })
    return ev
  }
  return { input, onChange, onNav, type, key }
}

describe('PersonPicker — táblázatos lépkedés', () => {
  it('a beviteli mező megkapja a data-jellemzőt', () => {
    expect(setup().input.dataset.wk).toBe('x|0|1|driver_id')
  })
  it('Tab: a begépelt név első találatát kiválasztja és jobbra lép', () => {
    const { type, key, onChange, onNav } = setup()
    type('bodo')
    const ev = key('Tab')
    expect(onChange).toHaveBeenCalledWith('b')
    expect(onNav).toHaveBeenCalledWith('next')
    expect(ev.defaultPrevented).toBe(true)
  })
  it('Shift+Tab visszalép, Enter lefelé; gépelés nélkül semmit nem ír át', () => {
    const { key, onChange, onNav, input } = setup({ value: 'a' })
    act(() => input.focus())
    key('Tab', true)
    key('Enter')
    expect(onNav.mock.calls.map((c) => c[0])).toEqual(['prev', 'down'])
    expect(onChange).not.toHaveBeenCalled()
  })
  it('Enter: a begépelt találatot menti, majd lefelé lép; ugyanazt a nevet nem menti újra', () => {
    const { type, key, onChange, onNav } = setup({ value: 'c' })
    type('cseh')
    key('Enter')
    expect(onChange).not.toHaveBeenCalled()
    type('arv')
    key('Enter')
    expect(onChange).toHaveBeenCalledWith('a')
    expect(onNav).toHaveBeenLastCalledWith('down')
  })
  it('ha nincs hova lépni, a Tab a szokásos módon megy tovább, de a begépelt nevet elmenti', () => {
    const onNav = vi.fn((_dir: 'next' | 'prev' | 'down') => false)
    const { type, key, onChange } = setup({ onNav })
    type('cili')
    const ev = key('Tab')
    expect(ev.defaultPrevented).toBe(false)
    expect(onChange).toHaveBeenCalledWith('c')
  })
  it('lépkedés nélkül (onNav nincs megadva) az Enter a régi módon az első találatot választja', () => {
    const { type, key, onChange } = setup({ onNav: undefined })
    type('bela')
    key('Enter')
    expect(onChange).toHaveBeenCalledWith('b')
  })
})
