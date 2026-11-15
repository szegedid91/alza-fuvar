// Nap vége: a lezárt nap összefoglalója (körök, takarítás, tankolás) és a dízel autók tankolás-lépése.
import type { RoundState } from './rounds'

export interface DayLine { title: string; detail: string; done: boolean }

// „1. kör: R járat — járat kész 05:12” soronként; a körnek mindig van sorszáma (egy körnél is)
export function roundLines(shifts: { round: number; code: string | null }[], states: RoundState[], hhmm: (iso: string) => string): DayLine[] {
  return shifts.map((sh, i) => {
    const st = states[i]
    return {
      title: `${sh.round}. kör: ${sh.code ? `${sh.code} járat` : 'járat'}`,
      detail: st?.doneAt ? `járat kész ${hhmm(st.doneAt)}` : 'nem lett kész',
      done: !!st?.doneAt,
    }
  })
}

export function cleaningLine(c: { done: boolean; at: string | null; photos: number } | null | undefined, hhmm: (iso: string) => string): DayLine {
  return c?.done
    ? { title: 'Takarítás', detail: `megvolt${c.at ? ` ${hhmm(c.at)}` : ''}${c.photos ? ` · ${c.photos} fotó` : ' · fotó nélkül'}`, done: true }
    : { title: 'Takarítás', detail: 'nem volt', done: false }
}

const liters = (n: number) => `${String(Math.round(n * 10) / 10).replace('.', ',')} l`
export function fuelLine(f: { done: boolean; at: string | null; liters: number } | null | undefined, hhmm: (iso: string) => string): DayLine {
  return f?.done
    ? { title: 'Tankolás', detail: `megvolt${f.at ? ` ${hhmm(f.at)}` : ''}${f.liters > 0 ? ` · ${liters(f.liters)}` : ''} · blokk feltöltve`, done: true }
    : { title: 'Tankolás', detail: 'nem volt', done: false }
}

// „Ma nem tankoltam” — a készüléken jegyezzük (autó + nap), hogy az „Autó lerakva” engedjen
const skipKey = (carId: string, date: string) => `fuel-skip:${carId}:${date}`
const listeners = new Set<() => void>()
export function subscribeFuelSkip(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }
export function getFuelSkip(carId: string | null | undefined, date: string): boolean {
  if (!carId) return false
  try { return localStorage.getItem(skipKey(carId, date)) === '1' } catch { return false }
}
export function setFuelSkip(carId: string, date: string, on: boolean) {
  try { if (on) localStorage.setItem(skipKey(carId, date), '1'); else localStorage.removeItem(skipKey(carId, date)) } catch { /* nem kritikus */ }
  listeners.forEach((l) => l())
}
