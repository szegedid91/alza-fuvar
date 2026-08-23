import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'

// Élő QR-olvasó (kamera). A dekódolt szöveget egyszer adja vissza.
export default function QrScanner({
  onResult,
  onCancel,
}: {
  onResult: (text: string) => void
  onCancel: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const firedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  // Ref-en át hívjuk az onResult-ot, hogy a szülő újrarenderelése (nem memoizált
  // callback) ne indítsa újra a kamerát beolvasás közben.
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()
    let cancelled = false

    async function start() {
      try {
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
          if (result && !firedRef.current) {
            firedRef.current = true
            onResultRef.current(result.getText())
            controlsRef.current?.stop()
          }
        })
        if (cancelled) controls.stop()
        else controlsRef.current = controls
      } catch (e) {
        setError(
          e instanceof Error && e.name === 'NotAllowedError'
            ? 'A kamera hozzáférés megtagadva. Engedélyezd a böngésző beállításaiban.'
            : 'Nem sikerült elindítani a kamerát.',
        )
      }
    }
    void start()
    return () => {
      cancelled = true
      controlsRef.current?.stop()
    }
  }, [])

  return (
    <div className="camera-overlay">
      <div className="camera-head">
        <span>QR-kód beolvasása</span>
        <button className="btn ghost sm auto" onClick={onCancel}>Mégse</button>
      </div>
      {error ? (
        <div className="camera-body"><div className="alert error">{error}</div></div>
      ) : (
        <div className="camera-body">
          <video ref={videoRef} playsInline muted className="camera-video" />
          <div className="qr-frame" />
          <p className="muted small" style={{ marginTop: 12 }}>Irányítsd a kamerát az autó QR-kódjára</p>
        </div>
      )}
    </div>
  )
}
