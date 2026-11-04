// Heti beosztás-tábla: egy cella (sofőr/rakodó/betanuló/járat) módosításának
// kiszámítása a SZERVERRŐL frissen olvasott sorból — nem a cache-ből (LOG-07:
// két vezető / két fül egymás módosítását törölte, mert a régi cache alapján
// mind a négy mezőt visszaírtuk).
export type ShiftPeople = { driver_id: string | null; loader_id: string | null; trainee_id: string | null; route_id: string | null }
export type ShiftField = keyof ShiftPeople

export function nextShiftValues(current: ShiftPeople | null, field: ShiftField, value: string, extra?: Partial<ShiftPeople>): ShiftPeople {
  return {
    driver_id: current?.driver_id ?? null, loader_id: current?.loader_id ?? null, trainee_id: current?.trainee_id ?? null,
    route_id: current?.route_id ?? null,
    [field]: value || null,
    ...(extra ?? {}),
  }
}

// Üres a cella (senki nincs rajta) → a sor törlendő
export function isEmptyShift(v: ShiftPeople): boolean {
  return !v.driver_id && !v.loader_id && !v.trainee_id
}
