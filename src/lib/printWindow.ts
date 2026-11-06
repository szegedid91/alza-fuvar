// Nyomtatható HTML megnyitása külön ablakban (a böngésző „Mentés PDF-ként” opciójával PDF lesz belőle).
// A html végén <script>window.print()</script> áll; ha a felugró ablak tiltott, rejtett iframe-ből nyomtatunk.
export function printHtml(html: string): void {
  const w = window.open('', '_blank')
  if (w) {
    w.document.write(html)
    w.document.close()
    return
  }
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const doc = frame.contentWindow?.document
  if (!doc) { frame.remove(); return }
  doc.open()
  doc.write(html.replace('<script>window.print()</script>', ''))
  doc.close()
  frame.contentWindow?.focus()
  frame.contentWindow?.print()
  setTimeout(() => frame.remove(), 60000)
}
