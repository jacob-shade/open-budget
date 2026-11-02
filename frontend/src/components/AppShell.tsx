import { useCallback, useEffect, useState } from 'react'
import type { User } from '../api/types'
import { useFinanceData, type FinanceData } from '../hooks/useFinanceData'
import { NAV, type NavItem } from '../nav'
import { AccountsPage } from '../pages/AccountsPage'
import { BudgetPage } from '../pages/BudgetPage'
import { BusinessPage } from '../pages/BusinessPage'
import { CashFlowPage } from '../pages/CashFlowPage'
import { OverviewPage } from '../pages/OverviewPage'
import { PlannedPage } from '../pages/PlannedPage'
import { TransactionsPage } from '../pages/TransactionsPage'
import { usePath } from '../router'
import { Icon } from './Icon'
import { Link } from './Link'
import { PlaidLinkButton } from './PlaidLinkButton'
import { Sidebar } from './Sidebar'

const COLLAPSED_KEY = 'open-budget:sidebar-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

interface Props {
  user: User
  onSignOut: () => void
}

/** Signed-in layout: collapsible sidebar, page header with sync/connect actions, and the current page. */
export function AppShell({ user, onSignOut }: Props) {
  const path = usePath()
  const data = useFinanceData()
  const { refresh, setError, setNotice } = data
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  // Pages can render their own header controls here (see TransactionsPage).
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null)
  // Sections with sub-pages (e.g. /business/3) match by prefix.
  const page = NAV.find((n) => n.path === path || (n.path !== '/' && path.startsWith(`${n.path}/`)))

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      // Storage unavailable: the choice lasts until reload.
    }
  }

  const onLinked = useCallback(
    (message: string) => {
      setNotice(message)
      setError(null)
      void refresh()
    },
    [refresh, setError, setNotice],
  )

  return (
    <div className={`shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar
        user={user}
        path={path}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onSignOut={onSignOut}
      />
      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}

      <div className="app">
        <header className="topbar">
          <div className="topbar-title">
            <button className="icon-button menu-button" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Icon name="menu" />
            </button>
            <h1>{page?.label ?? 'Page not found'}</h1>
          </div>
          {page?.path === '/transactions' ? (
            <div className="actions page-actions" ref={setHeaderSlot} />
          ) : (
            <div className="actions">
              <button className="button" onClick={data.syncAll} disabled={data.syncing || data.items.length === 0}>
                {data.syncing ? 'Syncing…' : 'Sync'}
              </button>
              <PlaidLinkButton onLinked={onLinked} onError={setError} />
            </div>
          )}
        </header>

        {data.error && (
          <div className="banner error" role="alert">
            {data.error}
            <button onClick={() => setError(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        {data.notice && (
          <div className="banner notice" role="status">
            {data.notice}
            <button onClick={() => setNotice(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        {data.loading ? <p className="empty">Loading…</p> : <Page page={page} path={path} data={data} onLinked={onLinked} headerSlot={headerSlot} />}
      </div>
    </div>
  )
}

function Page({
  page,
  path,
  data,
  onLinked,
  headerSlot,
}: {
  page: NavItem | undefined
  path: string
  data: FinanceData
  onLinked: (m: string) => void
  headerSlot: HTMLElement | null
}) {
  if (!page) {
    return (
      <main>
        <section className="panel planned">
          <h2>There's nothing at this address</h2>
          <Link className="button" href="/">
            Go to Overview
          </Link>
        </section>
      </main>
    )
  }
  if (page.planned) return <PlannedPage item={page} />
  switch (page.path) {
    case '/budget':
      return <BudgetPage refreshKey={data.transactions} />
    case '/cash-flow':
      return <CashFlowPage refreshKey={data.transactions} />
    case '/business':
      return <BusinessPage data={data} path={path} />
    case '/accounts':
      return <AccountsPage data={data} onLinked={onLinked} />
    case '/transactions':
      return <TransactionsPage accounts={data.accounts} refreshKey={data.transactions} headerSlot={headerSlot} />
    default:
      return <OverviewPage data={data} />
  }
}
