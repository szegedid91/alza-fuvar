import { useEffect, useState } from 'react'
import { clearNavPrompt, getNavApp, navPromptDest, openNav, NAV_LABEL, PROMPT_EVENT, type NavTarget } from '../lib/nav'
import Icon from './Icon'

// Teljes képernyős „Navigáció indítása”: a jelzés (Kiindultam / Járat kész) koppintása a WhatsAppot nyitotta —
// a telefon egy koppintásból csak egy appot enged. Visszaváltva ez az EGY koppintás indítja a navigációt.
export default function NavPromptOverlay({ sub, title, address, target, onClose }: {
  sub?: string | null; title: string; address?: string | null; target: NavTarget; onClose: () => void
}) {
  return (
    <div role="dialog" aria-label="Navigáció indítása" style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(5,10,20,0.96)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18, padding: '24px 20px calc(24px + env(safe-area-inset-bottom))' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 24 }}>Indulhat a navigáció</div>
        {sub && <div className="small muted" style={{ marginTop: 8 }}>{sub}</div>}
        <div style={{ fontWeight: 800, fontSize: 18, marginTop: 4 }}>{title}</div>
        {address && <div className="small muted">{address}</div>}
      </div>
      <button type="button" className="btn" style={{ minHeight: 110, fontSize: 22 }} onClick={() => { onClose(); openNav(target, { auto: true }) }}>
        <Icon name="navigation" size={30} />Navigáció indítása ({NAV_LABEL[getNavApp()]})
      </button>
      <button type="button" className="btn ghost" onClick={onClose}>Most nem</button>
    </div>
  )
}

// „Járat kész” után: navigáció a raktárba. A kezdőlapon él, mert a járat-kártya a kész jelzés után eltűnik.
export function DestNavPrompt() {
  const [dest, setDest] = useState(() => navPromptDest())
  useEffect(() => {
    const h = () => setDest(navPromptDest())
    window.addEventListener(PROMPT_EVENT, h)
    return () => window.removeEventListener(PROMPT_EVENT, h)
  }, [])
  if (!dest) return null
  return <NavPromptOverlay sub="Járat kész — irány a raktár" title={dest.title} address={dest.address} target={{ lat: dest.lat, lng: dest.lng }} onClose={() => { clearNavPrompt(); setDest(null) }} />
}
