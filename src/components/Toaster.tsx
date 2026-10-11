import { useToasts, dismissToast } from '../lib/toast'
import Icon from './Icon'

// A toastok az alsó menü fölött jelennek meg, koppintásra eltűnnek.
export default function Toaster() {
  const toasts = useToasts()
  if (toasts.length === 0) return null
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.kind === 'success' && <Icon name="check-circle" size={18} />}
          {t.kind === 'error' && <Icon name="alert-triangle" size={18} />}
          {t.kind === 'info' && <Icon name="info" size={18} />}
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  )
}
