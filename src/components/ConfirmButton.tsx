import { useEffect, useState, type ReactNode } from 'react'

// Kétlépcsős megerősítés beépítve (nem window.confirm — az iOS-en telepített
// appban a natív felugró ablak megbízhatatlan). Első koppintás: "Biztos?",
// második: végrehajtás. 4 mp után magától visszaáll.
export default function ConfirmButton({
  children, confirmLabel = 'Biztos? Igen', onConfirm, className = 'btn ghost sm auto', disabled, title, style,
}: {
  children: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  className?: string
  disabled?: boolean
  title?: string
  style?: React.CSSProperties
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])

  if (armed) {
    return (
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <button type="button" className="btn danger sm auto" onClick={() => { setArmed(false); onConfirm() }}>{confirmLabel}</button>
        <button type="button" className="btn ghost sm auto" onClick={() => setArmed(false)} aria-label="Mégse">✕</button>
      </span>
    )
  }
  return (
    <button type="button" className={className} disabled={disabled} title={title} style={style} onClick={() => setArmed(true)}>
      {children}
    </button>
  )
}
