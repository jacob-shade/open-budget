import { useCallback, useMemo, useState } from 'react'
import type { User } from '../api/types'
import { useFinanceData } from '../hooks/useFinanceData'
import { AccountsPanel } from './AccountsPanel'
import { PlaidLinkButton } from './PlaidLinkButton'
import { TransactionsTable } from './TransactionsTable'
import { UserMenu } from './UserMenu'

interface Props {
  user: User
  onSignOut: () => void
}

export function Dashboard({ user, onSignOut }: Props) {
  const data = useFinanceData()
  const { refresh, setError, setNotice } = data
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)

  const onLinked = useCallback(
    (message: string) => {
      setNotice(message)
      setError(null)
      void refresh()
    },
    [refresh, setError, setNotice],
  )

  const selectedAccount = data.accounts.find((a) => a.id === selectedAccountId) ?? null
  const transactions = useMemo(
    () => (selectedAccountId ? data.transactions.filter((t) => t.account_id === selectedAccountId) : data.transactions),
    [data.transactions, selectedAccountId],
  )

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <a className="home-link" href="/">
            <span className="logo" aria-hidden="true">
              💵
            </span>{' '}
            Open Budget
          </a>
        </h1>
        <div className="actions">
          <button className="button" onClick={data.syncAll} disabled={data.syncing || data.items.length === 0}>
            {data.syncing ? 'Syncing…' : 'Sync'}
          </button>
          <PlaidLinkButton onLinked={onLinked} onError={setError} />
          <UserMenu user={user} onSignOut={onSignOut} />
        </div>
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

      {data.loading ? (
        <p className="empty">Loading…</p>
      ) : (
        <main className="layout">
          <AccountsPanel
            items={data.items}
            accounts={data.accounts}
            selectedAccountId={selectedAccountId}
            onSelectAccount={setSelectedAccountId}
            onRemoveItem={data.removeItem}
            onReconnected={onLinked}
            onError={setError}
          />
          <TransactionsTable
            transactions={transactions}
            title={selectedAccount ? `${selectedAccount.name} transactions` : 'Recent transactions'}
            onClearFilter={selectedAccount ? () => setSelectedAccountId(null) : undefined}
          />
        </main>
      )}
    </div>
  )
}
