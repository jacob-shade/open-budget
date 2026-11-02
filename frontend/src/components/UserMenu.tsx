import { useEffect, useRef, useState } from 'react'
import type { User } from '../api/types'
import { useTheme, type ThemeChoice } from '../hooks/useTheme'

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

interface Props {
  user: User
  onSignOut: () => void
}

/** Profile picture button that opens a dropdown with the account and a sign-out action. */
export function UserMenu({ user, onSignOut }: Props) {
  const [open, setOpen] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const { theme, setTheme } = useTheme()

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

  const initial = (user.name || user.email).trim().charAt(0).toUpperCase()

  return (
    <div className="user-menu" ref={root}>
      <button
        className="avatar-button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.email}`}
      >
        {user.picture_url && !imgFailed ? (
          <img src={user.picture_url} alt="" referrerPolicy="no-referrer" onError={() => setImgFailed(true)} />
        ) : (
          <span className="avatar-initial">{initial}</span>
        )}
      </button>
      {open && (
        <div className="user-dropdown" role="menu">
          <div className="user-dropdown-account">
            {user.name && <strong>{user.name}</strong>}
            <span className="muted">{user.email}</span>
          </div>
          <div className="user-dropdown-label" id="theme-label">
            Theme
          </div>
          <div className="theme-switch" role="radiogroup" aria-labelledby="theme-label">
            {THEMES.map((t) => (
              <button
                key={t.value}
                className={`theme-option${theme === t.value ? ' selected' : ''}`}
                role="radio"
                aria-checked={theme === t.value}
                onClick={() => setTheme(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="user-dropdown-divider" role="separator" />
          <button className="user-dropdown-item" role="menuitem" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
