import { useMemo, useState } from 'react'
import { api } from '../api/client'
import type { Account } from '../api/types'
import type { FinanceData } from '../hooks/useFinanceData'
import { groupAccounts } from '../lib/accountGroups'
import { AccountGroups } from '../components/AccountGroups'
import { AccountsSummary } from '../components/AccountsSummary'
import { ApyDialog } from '../components/ApyDialog'
import { Connections } from '../components/Connections'
import { ManualAccountDialog } from '../components/ManualAccountDialog'
import { NetWorthChart } from '../components/NetWorthChart'
import { RenameAccountDialog } from '../components/RenameAccountDialog'

interface Props {
  data: FinanceData
  onLinked: (message: string) => void
}

/** Net worth over time, accounts grouped by type, a summary, and bank connections. */
export function AccountsPage({ data, onLinked }: Props) {
  const groups = useMemo(() => groupAccounts(data.accounts), [data.accounts])
  // null = closed; 'new' = add; an account = update it.
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [apyFor, setApyFor] = useState<Account | null>(null)
  const [renaming, setRenaming] = useState<Account | null>(null)
  return (
    <main className="accounts-page">
      <NetWorthChart refreshKey={data.accounts} />
      <div className="accounts-layout">
        <div className="stack">
          <div className="accounts-toolbar">
            <button className="button small" onClick={() => setEditing('new')}>
              + Add manual account
            </button>
          </div>
          <AccountGroups
            groups={groups}
            onEditManual={setEditing}
            onSetApy={setApyFor}
            onRename={setRenaming}
            onDeleteManual={(a) => api.deleteManualAccount(a.id).then(data.refresh, (e: Error) => data.setError(e.message))}
          />
          <Connections
            items={data.items}
            accounts={data.accounts}
            onRemoveItem={data.removeItem}
            onReconnected={onLinked}
            onError={data.setError}
          />
        </div>
        <AccountsSummary groups={groups} />
      </div>
      {renaming && <RenameAccountDialog account={renaming} onClose={() => setRenaming(null)} onSaved={() => void data.refresh()} />}
      {apyFor && <ApyDialog account={apyFor} onClose={() => setApyFor(null)} onSaved={() => void data.refresh()} />}
      {editing && (
        <ManualAccountDialog account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => void data.refresh()} />
      )}
    </main>
  )
}
