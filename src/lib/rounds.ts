// A napi körök állapota a jelzésekből. A futár napja körönként: Kiindultam → Járat kész → vissza a
// raktárba → Elszámoltam vagy Kiindultam a következő körre. A jelzésnek nincs kör-mezője, ezért a
// sorrendből következtetünk: az i-edik „Járat kész” az i-edik körhöz tartozik.
export interface RoundEvent { kind: string; at: string }
export interface RoundState {
  status: 'completed' | 'current' | 'upcoming'
  doneAt: string | null // „Járat kész”
  settledAt: string | null // „Elszámoltam” ehhez a körhöz (a kész után, a következő kész előtt)
}

export function roundStates(roundCount: number, events: RoundEvent[]): RoundState[] {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at))
  const ats = (kind: string) => sorted.filter((e) => e.kind === kind).map((e) => e.at)
  const dones = ats('done'); const settles = ats('settled'); const departs = ats('departed')
  const out: RoundState[] = []
  let currentSeen = false
  for (let i = 0; i < roundCount; i++) {
    const doneAt = dones[i] ?? null
    const nextDone = dones[i + 1] ?? null
    const settledAt = doneAt ? settles.find((s) => s > doneAt && (!nextDone || s < nextDone)) ?? null : null
    // lezárt kör: kész, ÉS utána elszámolt vagy már kiindult a következőre
    const completed = !!doneAt && (!!settledAt || departs.some((d) => d > doneAt))
    const status: RoundState['status'] = completed ? 'completed' : currentSeen ? 'upcoming' : 'current'
    if (!completed) currentSeen = true
    out.push({ status, doneAt, settledAt })
  }
  return out
}

// A nap lezárult: minden kör kész, és az utolsó után megvolt az elszámolás.
// Beosztott kör nélkül (nincs járat) az első elszámolás zárja a napot.
export function dayComplete(roundCount: number, events: RoundEvent[]): boolean {
  if (roundCount === 0) return events.some((e) => e.kind === 'settled')
  const states = roundStates(roundCount, events)
  return states.every((s) => !!s.doneAt) && !!states[states.length - 1].settledAt
}

// Minden mai kör „Járat kész”: innen már nem kell újra kiindulni — a raktárban az elszámolás és a nap
// vége (Box-lap zárása, takarítás, autó lerakva) következik. Beosztott kör nélkül nincs ilyen pont.
export function allRoundsDone(roundCount: number, events: RoundEvent[]): boolean {
  if (roundCount === 0) return false
  return roundStates(roundCount, events).every((s) => !!s.doneAt)
}
