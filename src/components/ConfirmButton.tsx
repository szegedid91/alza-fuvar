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

  // FONTOS: a megerősítő gomb UGYANAZZAL a mérettel/pozícióval jelenik meg,
  // mint az eredeti (className/style azonos) — ha kisebbre váltana, a második
  // koppintás telefonon mellémenne, és a művelet sosem futna le.
  // Mégse: 4 mp után magától visszaáll.
  if (armed) {
    return (
      <button
        type="button"
        className={className}
        // a disabled/title az élesített állapotban is érvényes marad: ha közben
        // letiltják a gombot, a megerősítés se süljön el
        disabled={disabled}
        title={title}
        style={{ ...style, background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }}
        onClick={() => { setArmed(false); onConfirm() }}
      >
        ⚠️ {confirmLabel}
      </button>
    )
  }
  return (
    <button type="button" className={className} disabled={disabled} title={title} style={style} onClick={() => setArmed(true)}>
      {children}
    </button>
  )
}
