import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  /** Contents of the trigger button. */
  label: ReactNode
  /** Accessible name when `label` isn't plain text. */
  ariaLabel?: string
  /** Highlights the trigger (e.g. while a filter is active). */
  active?: boolean
  align?: 'left' | 'right'
  children: (close: () => void) => ReactNode
}

/** A button that opens a panel below it; clicking outside or pressing Escape closes it. */
export function Popover({ label, ariaLabel, active, align = 'right', children }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="popover" ref={root}>
      <button
        className={`button${active ? ' active-filter' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
      >
        {label}
      </button>
      {open && (
        <div className={`popover-panel ${align}`} role="dialog" aria-label={ariaLabel}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
