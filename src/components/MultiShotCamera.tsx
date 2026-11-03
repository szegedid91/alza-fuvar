import { useEffect, useRef, useState } from 'react'
import { captureVideoFrame } from '../lib/image'
import Icon from './Icon'

// Élő kamera TÖBB képhez (pl. elszámolás): az exponáló egymás után rakja a
// képeket a sorba, a „Küldés” egy koppintás — a szülő ezen a koppintáson
// belül nyitja a megosztás-menüt (a böngésző csak érintésre engedi).
export default function MultiShotCamera({
  title,
  sendLabel = 'Küldés',
  onSend,
  onCancel,
}: {
  title: string
  sendLabel?: string
  onSend: (blobs: Blob[]) => void
  onCancel: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [snapping, setSnapping] = useState(false)
  const [shots, setShots] = useState<{ blob: Blob; url: string }[]>([])

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setReady(true)
      } catch (e) {
        setError(e instanceof Error && e.name === 'NotAllowedError'
          ? 'A kamera hozzáférés megtagadva. Engedélyezd a böngésző beállításaiban.'
          : 'Nem sikerült elindítani a kamerát.')
      }
    }
    void start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])
  // az előnézeti URL-ek felszabadítása bezáráskor
  useEffect(() => () => { shots.forEach((s) => URL.revokeObjectURL(s.url)) }, [shots])

  async function snap() {
    const video = videoRef.current
    if (!video || snapping) return
    setSnapping(true)
    try {
      const blob = await captureVideoFrame(video)
      if (blob) setShots((prev) => [...prev, { blob, url: URL.createObjectURL(blob) }])
    } finally {
      setSnapping(false)
    }
  }

  return (
    <div className="camera-overlay">
      <div className="camera-head">
        <span>{title}{shots.length ? ` · ${shots.length} kép` : ''}</span>
        <button className="btn ghost sm auto" onClick={onCancel}>Mégse</button>
      </div>
      {error ? (
        <div className="camera-body"><div className="alert error">{error}</div></div>
      ) : (
        <div className="camera-body">
          <video ref={videoRef} playsInline muted className="camera-video" />
          {shots.length > 0 && (
            <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, display: 'flex', gap: 6, overflowX: 'auto', zIndex: 2 }}>
              {shots.map((s, i) => (
                <div key={s.url} style={{ position: 'relative', flexShrink: 0 }}>
                  <img src={s.url} alt={`${i + 1}. kép`} style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 6, border: '2px solid #fff' }} />
                  <button type="button" aria-label="Kép törlése" onClick={() => setShots((prev) => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, border: 'none', background: '#b00020', color: '#fff', display: 'grid', placeItems: 'center', padding: 0 }}>
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {shots.length === 0 && <p className="tiny" style={{ position: 'absolute', top: 12, left: 12, right: 12, margin: 0, textAlign: 'center' }}>Készíts egy vagy több képet, majd koppints a Küldésre.</p>}
        </div>
      )}
      <div className="camera-foot" style={{ gap: 16, alignItems: 'center' }}>
        <button className="shutter" onClick={() => void snap()} disabled={!ready || !!error || snapping} aria-label="Fotó" />
        <button type="button" className="btn" disabled={shots.length === 0} onClick={() => onSend(shots.map((s) => s.blob))} style={{ minHeight: 56 }}>
          <Icon name="send" />{sendLabel}{shots.length ? ` (${shots.length})` : ''}
        </button>
      </div>
    </div>
  )
}
