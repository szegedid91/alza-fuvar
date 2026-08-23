import { useState } from 'react'
import CameraCapture from './CameraCapture'

export interface CapturedPhoto {
  blob: Blob
  previewUrl: string
}

// Egy fotó-hely: érintésre élő kamera nyílik, utána a bélyegkép látszik.
export default function PhotoSlot({
  label,
  photo,
  onCapture,
}: {
  label: string
  photo: CapturedPhoto | null
  onCapture: (p: CapturedPhoto) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="thumb-slot" onClick={() => setOpen(true)} style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}>
        {photo ? (
          <img src={photo.previewUrl} className="thumb" alt={label} />
        ) : (
          <div className="thumb thumb-empty">
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 26 }}>📷</div>
              <div className="tiny">{label}</div>
            </div>
          </div>
        )}
        {photo && <span className="cap">✔ {label}</span>}
      </button>
      {open && (
        <CameraCapture
          title={label}
          onCancel={() => setOpen(false)}
          onCapture={(blob, previewUrl) => {
            onCapture({ blob, previewUrl })
            setOpen(false)
          }}
        />
      )}
    </>
  )
}
