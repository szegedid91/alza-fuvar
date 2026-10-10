// Globális, rövid visszajelzések (toast) — a sikerüzenetek ne ragadjanak be
// az űrlap alatt örökre. A hibák továbbra is az űrlapnál maradnak (ott kell
// látni, mit kell javítani), a toast a "Mentve." típusú megerősítésekre való.
import { useSyncExternalStore } from 'react'

export type ToastKind = 'success' | 'error' | 'info'
export interface Toast { id: number; kind: ToastKind; text: string }

let toasts: Toast[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const DURATION: Record<ToastKind, number> = { success: 3000, info: 4000, error: 6000 }

function push(kind: ToastKind, text: string) {
  const id = ++seq
  toasts = [...toasts, { id, kind, text }]
  emit()
  setTimeout(() => dismissToast(id), DURATION[kind])
}

export function dismissToast(id: number) {
  if (!toasts.some((t) => t.id === id)) return
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export const toast = {
  success: (text: string) => push('success', text),
  error: (text: string) => push('error', text),
  info: (text: string) => push('info', text),
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => toasts,
  )
}
