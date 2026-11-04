// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { sanitizeHelpHtml, sanitizeFrameAttrs, parseHelpFrame } from './helpSanitize'

describe('sanitizeHelpHtml — SEC-01: a futár HTML-je a vezetőnél csak megjelenítés', () => {
  it('szkriptet, eseménykezelőt, beágyazást eldob', () => {
    const out = sanitizeHelpHtml('<div onclick="x()">a<script>evil()</script><img src="x" onerror="fetch(1)"><iframe src="//e"></iframe><object data="x"></object></div>')
    expect(out).not.toMatch(/script|onerror|onclick|iframe|object/i)
    expect(out).toContain('<div>a')
  })
  it('meta refresh, base és link elemek eltűnnek', () => {
    const out = sanitizeHelpHtml('<meta http-equiv="refresh" content="0;url=https://x"><base href="https://x/"><link rel="stylesheet" href="https://x/a.css"><p>ok</p>')
    expect(out).toBe('<p>ok</p>')
  })
  it('képforrás csak Storage / data-kép / relatív; a <a href> semlegesítve', () => {
    const out = sanitizeHelpHtml('<img src="https://abc.supabase.co/storage/v1/x.jpg"><img src="https://evil.example/t.gif"><img src="data:image/png;base64,AA"><a href="javascript:alert(1)">l</a><a href="https://evil.example">m</a>')
    expect(out).toContain('src="https://abc.supabase.co/storage/v1/x.jpg"')
    expect(out).not.toContain('evil.example')
    expect(out).toContain('src="data:image/png;base64,AA"')
    expect(out).not.toContain('javascript:')
    expect(out.match(/href="#"/g)?.length).toBe(2)
  })
  it('CSS url() beacon és @import kiszedve inline stílusból és <style>-ból', () => {
    const out = sanitizeHelpHtml('<div style="color:red;background:url(https://evil.example/b)">x</div><style>@import "https://evil.example/c.css"; .a{background:url(//evil.example/d)}</style>')
    expect(out).not.toContain('evil.example')
    expect(out).toContain('color:red')
  })
  it('ártalmatlan szerkezetet változatlanul hagy', () => {
    const html = '<div class="card"><h2>Mai nap</h2><button class="btn">Elindultam</button></div>'
    expect(sanitizeHelpHtml(html)).toBe(html)
  })
})

describe('sanitizeFrameAttrs — csak téma/nyelv attribútum mehet a keretre', () => {
  it('ismeretlen attribútum és idézőjel-kitörés eldobva', () => {
    expect(sanitizeFrameAttrs('lang="hu" data-theme="dark" onload="x()" class="a b"')).toBe('lang="hu" data-theme="dark" class="a b"')
    expect(sanitizeFrameAttrs('data-theme="&quot;><script>x</script>"')).toBe('data-theme="scriptxscript"')
  })
})

describe('parseHelpFrame — a broadcast csomag alakja', () => {
  it('hiányos vagy nem objektum → null', () => {
    expect(parseHelpFrame(null)).toBeNull()
    expect(parseHelpFrame({ html: 1 })).toBeNull()
    expect(parseHelpFrame({ html: 'x', w: 'a', h: 2 })).toBeNull()
  })
  it('értékek korlátok közé szorítva, hiányzók alapértékkel', () => {
    const f = parseHelpFrame({ html: 'x', w: 99999, h: 10, scroll: -5 })!
    expect(f.w).toBe(4000); expect(f.h).toBe(200); expect(f.scroll).toBe(0); expect(f.path).toBe('/')
  })
})
