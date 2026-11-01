import { useHelpShare, stopHelpShare } from '../lib/helpShare'
import Icon from './Icon'

// A futár képernyőjén, amíg a „Segítséget kérek” mód fut: jól látható sáv (a vezető látja a
// felületet), leállítás gomb, a vezető rámutatása (villanó kör) és üzenete.
export default function HelpShareBanner() {
  const s = useHelpShare()
  if (!s.active) return null
  return (
    <>
      <div data-help-ui role="status" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000, background: 'var(--warning)', color: '#111', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,.25)' }}>
        <Icon name="eye" size={18} />
        <span style={{ flex: 1 }}>{s.watching ? 'A vezető most látja a képernyődet' : 'Segítségkérés elküldve — a vezető bármikor ránézhet'}</span>
        <button type="button" onClick={() => void stopHelpShare(true)} style={{ background: '#111', color: '#fff', border: 'none', borderRadius: 999, padding: '6px 12px', fontWeight: 700, fontSize: 13 }}>Leállítás</button>
      </div>
      {s.message && (
        <div data-help-ui style={{ position: 'fixed', top: 48, left: 12, right: 12, zIndex: 1000, background: 'var(--bg-elev-2, #1f2937)', color: 'var(--text, #fff)', border: '2px solid var(--warning)', borderRadius: 12, padding: '10px 12px', fontSize: 15, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,.3)' }}>
          <Icon name="message-circle" size={16} /> Vezető: {s.message.text}
        </div>
      )}
      {s.pointer && (
        <div data-help-ui style={{ position: 'fixed', left: s.pointer.x - 28, top: s.pointer.y - 28, width: 56, height: 56, borderRadius: '50%', border: '4px solid var(--warning)', boxShadow: '0 0 0 6px rgba(245,158,11,.35), 0 0 24px rgba(245,158,11,.8)', zIndex: 999, pointerEvents: 'none', animation: 'help-pulse 0.8s ease-in-out infinite alternate' }} />
      )}
      <style>{`@keyframes help-pulse { from { transform: scale(0.85); opacity: .7 } to { transform: scale(1.1); opacity: 1 } }`}</style>
    </>
  )
}
