// Betöltés-helyőrző: a tartalom alakját mutatja (nem egy pörgő kört),
// így a szem már tudja, mi jön. rows: hány sor-sávot rajzolunk.
export default function Skeleton({ rows = 3, card = true }: { rows?: number; card?: boolean }) {
  const body = (
    <div className="skeleton" aria-busy="true" aria-label="Betöltés">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-line" style={{ width: i === 0 ? '55%' : i % 3 === 2 ? '70%' : '90%' }} />
      ))}
    </div>
  )
  return card ? <div className="card">{body}</div> : body
}
