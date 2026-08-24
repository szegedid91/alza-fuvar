// Lapozott lekérdezés: a PostgREST alapértelmezett 1000 soros plafonja miatt a
// hónap-szintű (bér, riport) lekérdezések csendben csonkulhatnának — ez a segéd
// minden sort visszahoz, és hibánál dob (nem "üres adat"-ként tűnik el a hiba).
// A hívó adjon stabil rendezést (pl. .order('id')) a lapozás konzisztenciájához!
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await page(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    // FIGYELEM: a pageSize nem lehet nagyobb a szerver sor-plafonjánál
    // (Supabase alapértelmezés: 1000) — különben a rövid oldal "végének" látszana.
    if (rows.length < pageSize) return out
    from += rows.length
  }
}
