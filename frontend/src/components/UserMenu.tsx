import { useEffect, useRef, useState } from 'react'
import type { User } from '../api/types'
import { useTheme, type ThemeChoice } from '../hooks/useTheme'
import { useAmountsDefault, type AmountsDefault } from '../lib/privacy'

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

const AMOUNTS: { value: AmountsDefault; label: string }[] = [
  { value: 'hidden', label: 'Hidden' },
  { value: 'shown', label: 'Shown' },
]

interface Props {
  user: User
  onSignOut: () => void
}

/** Profile row at the bottom of the sidebar; opens a menu upward with the theme picker, the default for sensitive amounts, and sign-out. */
export function UserMenu({ user, onSignOut }: Props) {
  const [open, setOpen] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const { theme, setTheme } = useTheme()
  const { amountsDefault, setAmountsDefault } = useAmountsDefault()

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
          <div className="user-dropdown-label" id="amounts-label">
            Sensitive amounts
          </div>
          <div className="theme-switch" role="radiogroup" aria-labelledby="amounts-label">
            {AMOUNTS.map((a) => (
              <button
                key={a.value}
                className={`theme-option${amountsDefault === a.value ? ' selected' : ''}`}
                role="radio"
                aria-checked={amountsDefault === a.value}
                onClick={() => setAmountsDefault(a.value)}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="user-dropdown-divider" role="separator" />
          <button className="user-dropdown-item" role="menuitem" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}
      <button
        className="profile-button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.email}`}
        title={user.email}
      >
        <span className="avatar">
          {user.picture_url && !imgFailed ? (
            <img src={user.picture_url} alt="" referrerPolicy="no-referrer" onError={() => setImgFailed(true)} />
          ) : (
            <span className="avatar-initial">{initial}</span>
          )}
        </span>
        <span className="profile-text sidebar-label">
          <strong>{user.name ?? user.email}</strong>
          {user.name && <span>{user.email}</span>}
        </span>
      </button>
    </div>
  )
}
