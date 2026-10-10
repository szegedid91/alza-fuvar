import { useToasts, dismissToast } from '../lib/toast'

// A toastok az alsó menü fölött jelennek meg, koppintásra eltűnnek.
export default function Toaster() {
  const toasts = useToasts()
  if (toasts.length === 0) return null
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.kind === 'success' ? '✔ ' : t.kind === 'error' ? '⚠ ' : ''}{t.text}
        </button>
      ))}
    </div>
  )
}
