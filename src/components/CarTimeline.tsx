// Időtartam emberi formában: 1 óra alatt percben, fölötte óra+perc
function dur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} p`
  return m % 60 === 0 ? `${m / 60} ó` : `${Math.floor(m / 60)} ó ${m % 60} p`
}

export interface TimelineEntry {
  plate: string
  from: string // checked_in_at
  to: string | null // checked_out_at (null = folyamatban)
  reason: string | null // miért váltott ERRE az autóra (az első szakasznál null)
}

// Napi autóhasználat idővonala: meddig melyik autó, és miért történt a váltás.
export default function CarTimeline({ entries }: { entries: TimelineEntry[] }) {
  const t = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="stack" style={{ gap: 0 }}>
      {entries.map((e, i) => (
        <div key={i}>
          {e.reason && (
            <div className="row" style={{ gap: 8, padding: '2px 0 2px 7px' }}>
              <div style={{ width: 2, alignSelf: 'stretch', background: 'var(--warning)', borderRadius: 1 }} />
              <span className="tiny" style={{ color: 'var(--warning)' }}>⚠️ Autócsere — {e.reason}</span>
            </div>
          )}
          <div className="row" style={{ gap: 10, alignItems: 'center', padding: '4px 0' }}>
            <span style={{ fontSize: 15 }}>🚚</span>
            <span className="small" style={{ fontWeight: 700, minWidth: 76 }}>{e.plate}</span>
            <span className="small muted">
              {t(e.from)} – {e.to ? t(e.to) : 'folyamatban'}
              {e.to && <> · {dur(new Date(e.to).getTime() - new Date(e.from).getTime())}</>}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
