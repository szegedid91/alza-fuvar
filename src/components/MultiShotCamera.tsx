import { useEffect, useRef, useState } from 'react'
import { captureVideoFrame } from '../lib/image'
import { baseMime, fmtClock, VIDEO_MIME_CANDIDATES } from '../lib/media'
import Icon from './Icon'
import { getCameraStream } from '../lib/camera'
import { TEST_MODE } from '../lib/testMode'
import TestCameraPick from './TestCameraPick'

// Egy videó legfeljebb ennyi másodperc (kb. 15 MB) — hosszabbhoz több rövid felvétel készíthető
const MAX_VIDEO_S = 60
const VIDEO_BITRATE = 2_000_000

type Shot = { blob: Blob; url: string; poster?: Blob; video?: boolean; seconds?: number }

// Élő kamera TÖBB képhez (pl. elszámolás): az exponáló egymás után rakja a
// képeket a sorba, a „Küldés” egy koppintás — a szülő ezen a koppintáson
// belül nyitja a megosztás-menüt (a böngésző csak érintésre engedi).
// video: videó is felvehető (visszáru-bizonyíték) — a piros gomb indítja és állítja le.
export default function MultiShotCamera({
  title,
  sendLabel = 'Küldés',
  hint = 'Készíts egy vagy több képet, majd koppints a Küldésre.',
  video = false,
  onSend,
  onCancel,
}: {
  title: string
  sendLabel?: string
  // mit fotózzon (a kamera tetején, amíg nincs kép)
  hint?: string
  video?: boolean
  // posters: videónál a felvétel egy képkockája (a galéria bélyegképéhez), képnél undefined
  onSend: (blobs: Blob[], posters: (Blob | undefined)[]) => void
  onCancel: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [snapping, setSnapping] = useState(false)
  const [shots, setShots] = useState<Shot[]>([])
  // videófelvétel
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const posterRef = useRef<Blob | null>(null)
  const startedRef = useRef(0)
  const discardRef = useRef(false)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  // ha a videó nem indul ezen a készüléken, a fotózás megy tovább — csak a piros gomb tűnik el
  const [videoOff, setVideoOff] = useState<string | null>(null)
  const canRecord = video && typeof MediaRecorder !== 'undefined' && !videoOff

  useEffect(() => {
    let cancelled = false
    discardRef.current = false // (fejlesztői dupla-mount után is) az új megnyitás felvételeit megtartjuk
    async function start() {
      try {
        const stream = await getCameraStream({
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
      // bezáráskor a futó felvételt eldobjuk
      discardRef.current = true
      try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop() } catch { /* már leállt */ }
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])
  // az előnézeti URL-ek felszabadítása bezáráskor — LOG-40: csak unmountkor (ref-ből), nem minden
  // új felvételnél (az minden meglévő bélyegkép URL-jét érvénytelenítette)
  const shotsRef = useRef(shots)
  shotsRef.current = shots
  useEffect(() => () => { shotsRef.current.forEach((s) => { if (s.url) URL.revokeObjectURL(s.url) }) }, [])

  // felvétel közben: másodperc-számláló, a határnál magától megáll
  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => {
      const s = (Date.now() - startedRef.current) / 1000
      setElapsed(s)
      if (s >= MAX_VIDEO_S) stopRecording()
    }, 250)
    return () => clearInterval(t)
  }, [recording])

  async function snap() {
    const v = videoRef.current
    if (!v || snapping || recording) return
    setSnapping(true)
    try {
      const blob = await captureVideoFrame(v)
      if (blob) setShots((prev) => [...prev, { blob, url: URL.createObjectURL(blob) }])
    } finally {
      setSnapping(false)
    }
  }

  async function startRecording() {
    const stream = streamRef.current, v = videoRef.current
    if (!stream || !v || recorderRef.current) return
    posterRef.current = await captureVideoFrame(v).catch(() => null) // az első képkocka lesz a bélyegkép
    // a készülék által elfogadott első formátum: a támogatottnak jelzett is elhasalhat indításkor, ezért sorban próbáljuk
    const candidates = [...VIDEO_MIME_CANDIDATES.filter((m) => { try { return MediaRecorder.isTypeSupported(m) } catch { return false } }), '']
    for (const mime of candidates) {
      try {
        const r = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: VIDEO_BITRATE })
        chunksRef.current = []
        r.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data) }
        r.onstop = () => {
          recorderRef.current = null
          setRecording(false)
          if (discardRef.current) return
          const blob = new Blob(chunksRef.current, { type: baseMime(r.mimeType || mime) || 'video/mp4' })
          const poster = posterRef.current ?? undefined
          const seconds = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000))
          if (blob.size > 0) setShots((prev) => [...prev, { blob, url: poster ? URL.createObjectURL(poster) : '', poster, video: true, seconds }])
        }
        r.onerror = () => { setVideoOff('A videófelvétel megszakadt — készíts fotókat.') }
        r.start(1000)
        recorderRef.current = r
        startedRef.current = Date.now()
        setElapsed(0)
        setRecording(true)
        return
      } catch { /* következő formátum */ }
    }
    recorderRef.current = null
    setRecording(false)
    setVideoOff('Ezen a készüléken nem indul a videófelvétel — készíts fotókat, több képen.')
  }
  function stopRecording() {
    try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop() } catch { /* már leállt */ }
  }

  const photos = shots.filter((s) => !s.video).length, videos = shots.length - photos
  const countText = [photos ? `${photos} kép` : '', videos ? `${videos} videó` : ''].filter(Boolean).join(', ')

  return (
    <div className="camera-overlay">
      <div className="camera-head">
        <span>{title}{countText ? ` · ${countText}` : ''}</span>
        {import.meta.env.DEV && TEST_MODE && <TestCameraPick />}
        <button className="btn ghost sm auto" onClick={onCancel}>Mégse</button>
      </div>
      {error ? (
        <div className="camera-body"><div className="alert error">{error}</div></div>
      ) : (
        <div className="camera-body">
          <video ref={videoRef} playsInline muted className="camera-video" />
          {recording && (
            <div style={{ position: 'absolute', top: 12, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 3 }}>
              <span className="num" style={{ background: 'rgba(176,0,32,0.9)', color: '#fff', padding: '6px 12px', borderRadius: 999, fontWeight: 800 }}>● Felvétel {fmtClock(elapsed)} / {fmtClock(MAX_VIDEO_S)}</span>
            </div>
          )}
          {shots.length > 0 && (
            <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, display: 'flex', gap: 6, overflowX: 'auto', zIndex: 2 }}>
              {shots.map((s, i) => (
                <div key={`${s.url}-${i}`} style={{ position: 'relative', flexShrink: 0 }}>
                  {s.url
                    ? <img src={s.url} alt={s.video ? `${i + 1}. videó` : `${i + 1}. kép`} style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 6, border: '2px solid #fff' }} />
                    : <div style={{ width: 64, height: 48, borderRadius: 6, border: '2px solid #fff', background: '#222' }} />}
                  {s.video && <span className="tiny" style={{ position: 'absolute', left: 4, bottom: 4, background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 4, padding: '0 4px', fontWeight: 700 }}>▶ {fmtClock(s.seconds ?? 0)}</span>}
                  <button type="button" aria-label={s.video ? 'Videó törlése' : 'Kép törlése'} onClick={() => setShots((prev) => { if (prev[i].url) URL.revokeObjectURL(prev[i].url); return prev.filter((_, j) => j !== i) })}
                    style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, border: 'none', background: '#b00020', color: '#fff', display: 'grid', placeItems: 'center', padding: 0 }}>
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {videoOff && <p className="tiny" style={{ position: 'absolute', top: 12, left: 12, right: 12, margin: 0, textAlign: 'center', background: 'rgba(176,0,32,0.85)', color: '#fff', padding: '6px 8px', borderRadius: 8, zIndex: 3 }}>{videoOff}</p>}
          {shots.length === 0 && !recording && !videoOff && <p className="tiny" style={{ position: 'absolute', top: 12, left: 12, right: 12, margin: 0, textAlign: 'center', background: 'rgba(0,0,0,0.55)', color: '#fff', padding: '6px 8px', borderRadius: 8 }}>{hint}</p>}
        </div>
      )}
      <div className="camera-foot" style={{ gap: 14, alignItems: 'center' }}>
        <button className="shutter" onClick={() => void snap()} disabled={!ready || !!error || snapping || recording} aria-label="Fotó" />
        {canRecord && (
          <button type="button" onClick={() => (recording ? stopRecording() : void startRecording())} disabled={!ready || !!error || snapping}
            aria-label={recording ? 'Videó leállítása' : 'Videó indítása'}
            style={{ width: 56, height: 56, borderRadius: 28, border: '3px solid #fff', background: 'transparent', display: 'grid', placeItems: 'center', padding: 0, flexShrink: 0, opacity: !ready || !!error ? 0.4 : 1 }}>
            <span style={{ width: recording ? 20 : 36, height: recording ? 20 : 36, borderRadius: recording ? 4 : 18, background: '#e53935', display: 'block' }} />
          </button>
        )}
        <button type="button" className="btn" disabled={shots.length === 0 || recording} onClick={() => onSend(shots.map((s) => s.blob), shots.map((s) => s.poster))} style={{ minHeight: 56 }}>
          <Icon name="send" />{sendLabel}{shots.length ? ` (${shots.length})` : ''}
        </button>
      </div>
      {canRecord && <div className="tiny" style={{ textAlign: 'center', color: '#ccc', background: 'rgba(0,0,0,0.6)', paddingBottom: 'calc(8px + env(safe-area-inset-bottom))', marginTop: -20 }}>fehér gomb: fotó · piros gomb: videó (max. 1 perc)</div>}
    </div>
  )
}
