// Box-jegyzék import: a „megszűnt” boxok inaktiválásának határa a SZERVER órája szerint
// (LOG-11: a telefon órájával egy előresiető óra az összes, most felvitt boxot is inaktiválta,
// egy késő óra pedig semmit). A határ = a most felvitt sorok legkisebb updated_at-ja; a
// trigger / default a szerveren állítja, így minden idei sor >= határ.
export function batchStartFromRows(rows: { updated_at: string | null }[]): string | null {
  let min: string | null = null
  for (const r of rows) {
    if (!r.updated_at) continue
    if (min === null || r.updated_at < min) min = r.updated_at
  }
  return min
}
