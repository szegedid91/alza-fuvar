import { useState } from 'react'
import { usePendingUpdate } from '../lib/swUpdate'

// "Új verzió elérhető" sáv — a frissítés a felhasználó koppintására történik.
export default function UpdateBanner() {
  const update = usePendingUpdate()
  const [busy, setBusy] = useState(false)
  if (!update) return null
  return (
    <div className="update-banner" role="status">
      <span>🆕 Új verzió elérhető</span>
      <button
        className="btn sm auto"
        disabled={busy}
        onClick={() => { setBusy(true); void update(true) }}
      >
        {busy ? 'Frissítés…' : 'Frissítés'}
      </button>
    </div>
  )
}
