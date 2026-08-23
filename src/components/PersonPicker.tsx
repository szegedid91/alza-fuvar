import { useEffect, useRef, useState, type CSSProperties } from 'react'

export interface PickerOption { id: string; label: string }

// Kereshető választó: gépelésre szűkül a lista (ékezet-független),
// koppintásra választ, × törli. A lista fixen pozicionált, így a
// vízszintesen görgethető táblázat sem vágja le.
export default function PersonPicker({
  value, options, placeholder, onChange, disabled, compact, danger, title,
}: {
  value: string
  options: PickerOption[]
  placeholder: string
  onChange: (id: string) => void
  disabled?: boolean
  compact?: boolean
  danger?: boolean
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.id === value)
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const filtered = q.trim() ? options.filter((o) => norm(o.label).includes(norm(q))) : options

  function openList() {
    if (disabled) return
    const r = inputRef.current?.getBoundingClientRect()
    if (r) {
      const width = Math.max(r.width, 230)
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
      setRect({ top: r.bottom + 4, left, width })
    }
    setQ('')
    setOpen(true)
  }

  function pick(id: string) {
    onChange(id)
    setOpen(false)
    setQ('')
    inputRef.current?.blur()
  }

  // Görgetésre/átméretezésre bezárjuk (a lista saját görgetése kivétel)
  useEffect(() => {
    if (!open) return
    const onScroll = (e: Event) => {
      if (listRef.current && e.target instanceof Node && listRef.current.contains(e.target)) return
      setOpen(false)
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const inputStyle: CSSProperties = compact
    ? { minHeight: 32, padding: '4px 26px 4px 6px', fontSize: 12, borderRadius: 8 }
    : { paddingRight: 34 }

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        className="input"
        style={{ ...inputStyle, borderColor: danger ? 'var(--danger)' : undefined }}
        value={open ? q : (selected?.label ?? '')}
        placeholder={placeholder}
        title={title}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={openList}
        onClick={() => { if (!open) openList() }}
        onChange={(e) => { setQ(e.target.value); if (!open) setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (filtered[0]) pick(filtered[0].id) }
          if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
        }}
      />
      {value && !open && !disabled && (
        <button
          type="button"
          aria-label="Törlés"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
          style={{
            position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
            border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer',
            fontSize: compact ? 14 : 18, lineHeight: 1, padding: '2px 4px',
          }}
        >
          ×
        </button>
      )}
      {open && rect && (
        <div
          ref={listRef}
          style={{
            position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 300,
            background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: 'var(--shadow)', maxHeight: 240, overflowY: 'auto',
          }}
        >
          {filtered.length === 0 && <div className="small muted" style={{ padding: '10px 12px' }}>Nincs találat</div>}
          {filtered.map((o) => (
            <div
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(o.id)}
              style={{
                padding: '10px 12px', cursor: 'pointer', fontSize: 14,
                background: o.id === value ? 'var(--primary-ghost)' : undefined,
                color: o.id === value ? 'var(--primary)' : undefined,
                fontWeight: o.id === value ? 700 : 500,
                borderBottom: '1px solid var(--border)',
              }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
