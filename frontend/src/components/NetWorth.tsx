import type { Account } from '../api/types'
import { formatMoney } from '../format'
import { summarize } from '../lib/netWorth'

export function NetWorth({ accounts }: { accounts: Account[] }) {
  const { assets, liabilities, netWorth } = summarize(accounts)
  return (
    <div className="net-worth">
      <span className="label">Net worth</span>
      <span className="value">{formatMoney(netWorth)}</span>
      <div className="breakdown">
        <span>Assets {formatMoney(assets)}</span>
        <span>Liabilities {formatMoney(-liabilities)}</span>
      </div>
    </div>
  )
}
