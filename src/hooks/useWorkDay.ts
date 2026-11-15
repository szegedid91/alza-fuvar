import { useSyncExternalStore } from 'react'
import { subscribeWorkDay, workDayISO } from '../lib/workDay'

// A futár aktuális munkanapja (YYYY-MM-DD). Újrarajzol, ha a nyitott becsekkolás rögzítése változik,
// és este 18:00-kor, amikor a munkanap a következő napra vált.
export function useWorkDay(): string {
  return useSyncExternalStore(subscribeWorkDay, () => workDayISO(), () => workDayISO())
}
