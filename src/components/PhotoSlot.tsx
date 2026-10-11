import { useState } from 'react'
import CameraCapture from './CameraCapture'
import Icon from './Icon'

export interface CapturedPhoto {
  blob: Blob
  previewUrl: string
}

// Egy fotó-hely: érintésre élő kamera nyílik, utána a bélyegkép látszik.
// onOpen: ha a szülő adja, a koppintás NEM itt nyit kamerát, hanem a szülő
// kezeli (pl. autó-ellenőrzés: felvétel után automatikusan a következő nézet).
export default function PhotoSlot({
  label,
  photo,
  onCapture,
  onOpen,
}: {
  label: string
  photo: CapturedPhoto | null
  onCapture: (p: CapturedPhoto) => void
  onOpen?: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="thumb-slot" onClick={() => (onOpen ? onOpen() : setOpen(true))} style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}>
        {photo ? (
          <img src={photo.previewUrl} className="thumb" alt={label} />
        ) : (
          <div className="thumb thumb-empty">
            <div style={{ textAlign: 'center' }}>
              <Icon name="camera" size={28} />
              <div className="tiny" style={{ marginTop: 4 }}>{label}</div>
            </div>
          </div>
        )}
        {photo && <span className="cap"><Icon name="check" size={12} style={{ verticalAlign: -2 }} /> {label}</span>}
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
