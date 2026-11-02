import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

interface Props {
  /** Contents of the trigger button. */
  label: ReactNode
  /** Accessible name when `label` isn't plain text. */
  ariaLabel?: string
  /** Highlights the trigger (e.g. while a filter is active). */
  active?: boolean
  align?: 'left' | 'right'
  /** Class for the trigger button (default: a regular button). */
  triggerClassName?: string
  children: (close: () => void) => ReactNode
}

const GAP = 6
const MARGIN = 12

/**
 * A button that opens a panel next to it. The panel is positioned against the window, so it isn't
 * cut off inside scrolling tables or dialogs; it opens upward when there's more room above.
 * Clicking outside, pressing Escape, scrolling the page or resizing closes it.
 */
export function Popover({ label, ariaLabel, active, align = 'right', triggerClassName = 'button', children }: Props) {
  const [style, setStyle] = useState<CSSProperties | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const open = style !== null

  const toggle = () => {
    if (open || !button.current) {
      setStyle(null)
      return
    }
    const r = button.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - GAP - MARGIN
    const above = r.top - GAP - MARGIN
    const up = below < 320 && above > below
    setStyle({
      position: 'fixed',
      ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
      ...(align === 'left' ? { left: Math.max(MARGIN, r.left) } : { right: Math.max(MARGIN, window.innerWidth - r.right) }),
      maxHeight: Math.max(160, up ? above : below),
    })
  }

  useEffect(() => {
    if (!open) return
    const close = () => setStyle(null)
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Close just this panel, not a dialog it sits in.
      e.preventDefault()
      e.stopPropagation()
      close()
      button.current?.focus()
    }
    const onScroll = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <div className="popover" ref={root}>
      <button
        ref={button}
        type="button"
        className={`${triggerClassName}${active ? ' active-filter' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
      >
        {label}
      </button>
      {open && (
        <div className="popover-panel" style={style} role="dialog" aria-label={ariaLabel}>
          {children(() => setStyle(null))}
        </div>
      )}
    </div>
  )
}
