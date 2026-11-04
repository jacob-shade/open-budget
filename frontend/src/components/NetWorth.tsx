import type { Account } from '../api/types'
import { formatMoney } from '../format'
import { summarize } from '../lib/netWorth'
import { HIDDEN_AMOUNT, useAmountsShown } from '../lib/privacy'
import { NetWorthToggle } from './NetWorthToggle'

export function NetWorth({ accounts }: { accounts: Account[] }) {
  const { assets, liabilities, netWorth } = summarize(accounts)
  const [shown, toggleShown] = useAmountsShown()
  return (
    <div className="net-worth">
      <span className="label with-toggle">
        Net worth <NetWorthToggle shown={shown} onToggle={toggleShown} what="net worth" />
      </span>
      <span className="value">{shown ? formatMoney(netWorth) : HIDDEN_AMOUNT}</span>
      <div className="breakdown">
        <span>Assets {shown ? formatMoney(assets) : HIDDEN_AMOUNT}</span>
        <span>Liabilities {shown ? formatMoney(Math.abs(liabilities)) : HIDDEN_AMOUNT}</span>
      </div>
    </div>
  )
}
