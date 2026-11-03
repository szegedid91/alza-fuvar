import { useEffect, useRef, useState } from 'react'
import { captureVideoFrame } from '../lib/image'

// Élő kamera (nincs galéria). Egy képkocka elkapása JPEG blobként.
export default function CameraCapture({
  title,
  onCapture,
  onCancel,
}: {
  title: string
  onCapture: (blob: Blob, previewUrl: string) => void
  onCancel: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setReady(true)
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
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const [snapping, setSnapping] = useState(false)
  async function snap() {
    const video = videoRef.current
    if (!video || snapping) return
    setSnapping(true)
    try {
      const blob = await captureVideoFrame(video)
      if (!blob) return
      onCapture(blob, URL.createObjectURL(blob))
    } finally {
      setSnapping(false)
    }
  }

  return (
    <div className="camera-overlay">
      <div className="camera-head">
        <span>{title}</span>
        <button className="btn ghost sm auto" onClick={onCancel}>Mégse</button>
      </div>
      {error ? (
        <div className="camera-body"><div className="alert error">{error}</div></div>
      ) : (
        <div className="camera-body">
          <video ref={videoRef} playsInline muted className="camera-video" />
        </div>
      )}
      <div className="camera-foot">
        <button className="shutter" onClick={() => void snap()} disabled={!ready || !!error || snapping} aria-label="Fotó" />
      </div>
    </div>
  )
}
