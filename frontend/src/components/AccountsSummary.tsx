import { useState } from 'react'
import type { AccountGroup } from '../lib/accountGroups'
import { formatMoney } from '../format'
import { Segmented } from './Segmented'

type Mode = 'amount' | 'percent'

const MODES: { value: Mode; label: string }[] = [
  { value: 'amount', label: '$' },
  { value: 'percent', label: '%' },
]

/** Assets and liabilities broken down by type; % shows each type's share of its side. */
export function AccountsSummary({ groups }: { groups: AccountGroup[] }) {
  const [mode, setMode] = useState<Mode>('amount')
  const assets = groups.filter((g) => !g.liability && (g.key !== 'other' || g.accounts.length > 0))
  const liabilities = groups.filter((g) => g.liability)
  const assetTotal = assets.reduce((s, g) => s + g.totalCents, 0)
  const liabilityTotal = liabilities.reduce((s, g) => s + g.totalCents, 0)

  const side = (title: string, list: AccountGroup[], total: number, kind: 'asset' | 'liability') => (
    <div className="summary-side">
      <div className="summary-head">
        <h3>{title}</h3>
        <span className={kind === 'liability' && total > 0 ? 'negative' : ''}>{mode === 'amount' ? formatMoney(total) : total > 0 ? '100%' : '—'}</span>
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
              <span className="summary-value">{mode === 'amount' ? formatMoney(g.totalCents) : `${(share * 100).toFixed(1)}%`}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )

  return (
    <section className="panel accounts-summary">
      <div className="panel-header">
        <h2>Summary</h2>
        <Segmented label="Show as" options={MODES} value={mode} onChange={setMode} />
      </div>
      {side('Assets', assets, assetTotal, 'asset')}
      {side('Liabilities', liabilities, liabilityTotal, 'liability')}
      <div className="summary-net">
        <span>Net worth</span>
        <strong>{formatMoney(assetTotal - liabilityTotal)}</strong>
      </div>
    </section>
  )
}
