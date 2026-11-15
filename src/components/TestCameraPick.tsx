import { useRef } from 'react'
import { setTestCameraImage, testCameraImageName, useTestEvents } from '../lib/testMode'
import { toast } from '../lib/toast'

// TESZTMÓD (csak a gépen): az álkamera képe fájlból is választható — pl. egy valódi
// box-kijelző fotója, hogy a kiolvasás is kipróbálható legyen. A zár gomb ezt a képet „fotózza le”.
export default function TestCameraPick() {
  const input = useRef<HTMLInputElement>(null)
  useTestEvents() // a választott kép neve változásakor újrarajzol
  const name = testCameraImageName()
  return (
    <span className="row" style={{ gap: 6, alignItems: 'center' }}>
      <input ref={input} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          e.target.value = ''
          if (f) void setTestCameraImage(f).catch(() => toast.error('A kép nem olvasható'))
        }} />
      <button type="button" className="btn ghost sm auto" style={{ borderColor: '#f59e0b', color: '#f59e0b' }} onClick={() => input.current?.click()}>
        {name ? 'Másik kép' : 'Teszt: kép fájlból'}
      </button>
      {name && <button type="button" className="btn ghost sm auto" onClick={() => void setTestCameraImage(null)}>tesztkép</button>}
    </span>
  )
}
