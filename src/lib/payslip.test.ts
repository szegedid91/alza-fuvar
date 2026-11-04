import { describe, it, expect } from 'vitest'
import { escHtml } from './payslip'

describe('escHtml — bérlap HTML-escape (SEC-18)', () => {
  it('a tag-jelek és az idézőjelek is escape-elve', () => {
    expect(escHtml(`<b>"Kovács" & 'Társa'</b>`)).toBe('&lt;b&gt;&quot;Kovács&quot; &amp; &#39;Társa&#39;&lt;/b&gt;')
  })
})
