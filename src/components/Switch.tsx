// Ki/be kapcsoló: a pozíció és a szín mutatja az állapotot (zöld + jobbra = be, szürke + balra = ki),
// mellette szöveggel is kiírva — nem kell kitalálni, hogy a felirat állapot vagy teendő.
export default function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span className="switch-knob" />
    </button>
  )
}

// Egy beállítás-sor: név + állapot szöveggel, jobb oldalt a kapcsoló
export function SwitchRow({ title, on, onChange, disabled, hint }: { title: string; on: boolean; onChange: (next: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <div className="between switch-row">
      <div style={{ minWidth: 0 }}>
        <div className="small" style={{ fontWeight: 700 }}>{title}</div>
        <div className={`switch-state ${on ? 'on' : ''}`}>{on ? 'Bekapcsolva' : 'Kikapcsolva'}{hint ? ` — ${hint}` : ''}</div>
      </div>
      <Switch on={on} onChange={onChange} label={title} disabled={disabled} />
    </div>
  )
}
