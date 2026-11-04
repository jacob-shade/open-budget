import { useState } from 'react'
import type { AccountGroup } from '../lib/accountGroups'
import { formatMoney } from '../format'
import { HIDDEN_AMOUNT, useAmountsShown } from '../lib/privacy'
import { NetWorthToggle } from './NetWorthToggle'
import { Segmented } from './Segmented'

type Mode = 'amount' | 'percent'

const MODES: { value: Mode; label: string }[] = [
  { value: 'amount', label: '$' },
  { value: 'percent', label: '%' },
]

/** Assets and liabilities broken down by type; % shows each type's share of its side. */
export function AccountsSummary({ groups }: { groups: AccountGroup[] }) {
  const [mode, setMode] = useState<Mode>('amount')
  const [shown, toggleShown] = useAmountsShown()
  const assets = groups.filter((g) => !g.liability && (g.key !== 'other' || g.accounts.length > 0))
  const liabilities = groups.filter((g) => g.liability)
  const assetTotal = assets.reduce((s, g) => s + g.totalCents, 0)
  const liabilityTotal = liabilities.reduce((s, g) => s + g.totalCents, 0)

  const side = (title: string, list: AccountGroup[], total: number, kind: 'asset' | 'liability') => (
    <div className="summary-side">
      <div className="summary-head">
        <h3>{title}</h3>
        <span className={kind === 'liability' && total > 0 ? 'negative' : ''}>
          {mode === 'amount' ? (shown ? formatMoney(total) : HIDDEN_AMOUNT) : total > 0 ? '100%' : '—'}
        </span>
      </div>
      <ul>
        {list.map((g) => {
          const share = total > 0 ? g.totalCents / total : 0
          return (
            <li key={g.key}>
              <span className="summary-label">{g.label}</span>
              <span className="summary-track" aria-hidden="true">
                <span className={`summary-bar ${kind}`} style={{ width: `${share * 100}%` }} />
              </span>
              <span className="summary-value">{mode === 'amount' ? (shown ? formatMoney(g.totalCents) : HIDDEN_AMOUNT) : `${(share * 100).toFixed(1)}%`}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )

  return (
    <section className="panel accounts-summary">
      <div className="panel-header">
        <h2 className="with-toggle">
          Summary <NetWorthToggle shown={shown} onToggle={toggleShown} what="summary amounts" />
        </h2>
        <Segmented label="Show as" options={MODES} value={mode} onChange={setMode} />
      </div>
      {side('Assets', assets, assetTotal, 'asset')}
      {side('Liabilities', liabilities, liabilityTotal, 'liability')}
      <div className="summary-net">
        <span className="with-toggle">
          Net worth <NetWorthToggle shown={shown} onToggle={toggleShown} what="summary amounts" />
        </span>
        <strong>{shown ? formatMoney(assetTotal - liabilityTotal) : HIDDEN_AMOUNT}</strong>
      </div>
    </section>
  )
}
