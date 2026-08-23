import { useEffect, useRef, useState } from 'react'
import { compressImage } from '../lib/image'

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

  function snap() {
    const video = videoRef.current
    if (!video) return
    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, w, h)
    canvas.toBlob(
      async (blob) => {
        if (!blob) return
        const compressed = await compressImage(blob)
        onCapture(compressed, URL.createObjectURL(compressed))
      },
      'image/jpeg',
      0.9,
    )
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
        <button className="shutter" onClick={snap} disabled={!ready || !!error} aria-label="Fotó" />
      </div>
    </div>
  )
}
