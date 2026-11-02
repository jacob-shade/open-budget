import type { User } from '../api/types'
import { NAV } from '../nav'
import { Icon } from './Icon'
import { Link } from './Link'
import { UserMenu } from './UserMenu'

interface Props {
  user: User
  path: string
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Narrow screens: the sidebar is a drawer opened from the menu button. */
  mobileOpen: boolean
  onCloseMobile: () => void
  onSignOut: () => void
}

export function Sidebar({ user, path, collapsed, onToggleCollapsed, mobileOpen, onCloseMobile, onSignOut }: Props) {
  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' open' : ''}`} aria-label="Main menu">
      <div className="sidebar-top">
        <Link className="home-link sidebar-logo" href="/" onClick={onCloseMobile} title="Open Budget">
          <span className="logo" aria-hidden="true">
            💵
          </span>
          <span className="sidebar-label">Open Budget</span>
        </Link>
        <button
          className="icon-button collapse-toggle"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Keep sidebar open' : 'Collapse sidebar'}
          aria-pressed={!collapsed}
          title={collapsed ? 'Keep sidebar open' : 'Collapse sidebar'}
        >
          <Icon name="sidebar" />
        </button>
        <button className="icon-button sidebar-close" onClick={onCloseMobile} aria-label="Close menu">
          <Icon name="close" />
        </button>
      </div>

      <nav className="sidebar-nav">
        <ul>
          {NAV.map((item) => {
            const active = item.path === path
            return (
              <li key={item.path}>
                <Link
                  href={item.path}
                  className={`nav-link${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={onCloseMobile}
                >
                  <Icon name={item.icon} />
                  <span className="sidebar-label">{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="sidebar-bottom">
        <UserMenu user={user} onSignOut={onSignOut} />
      </div>
    </aside>
  )
}
