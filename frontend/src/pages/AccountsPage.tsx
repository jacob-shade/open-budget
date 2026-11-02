import { useMemo } from 'react'
import type { FinanceData } from '../hooks/useFinanceData'
import { groupAccounts } from '../lib/accountGroups'
import { AccountGroups } from '../components/AccountGroups'
import { AccountsSummary } from '../components/AccountsSummary'
import { Connections } from '../components/Connections'
import { NetWorthChart } from '../components/NetWorthChart'

interface Props {
  data: FinanceData
  onLinked: (message: string) => void
}

/** Net worth over time, accounts grouped by type, a summary, and bank connections. */
export function AccountsPage({ data, onLinked }: Props) {
  const groups = useMemo(() => groupAccounts(data.accounts), [data.accounts])
  return (
    <main className="accounts-page">
      <NetWorthChart refreshKey={data.accounts} />
      <div className="accounts-layout">
        <div className="stack">
          <AccountGroups groups={groups} />
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
    </main>
  )
}
