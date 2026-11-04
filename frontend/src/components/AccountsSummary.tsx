import { useState } from 'react'
import type { AccountGroup } from '../lib/accountGroups'
import { formatMoney } from '../format'
import { HIDDEN_AMOUNT, useAmountsShown } from '../lib/privacy'
import { NetWorthToggle } from './NetWorthToggle'
import { Segmented } from './Segmented'

type Mode = 'amount' | 'percent'

const pctOf = (cents: number, total: number) => (total > 0 ? `${((cents / total) * 100).toFixed(1)}%` : '—')

const MODES: { value: Mode; label: string }[] = [
  { value: 'amount', label: '$' },
  { value: 'percent', label: '%' },
]

/** Assets and liabilities broken down by type; % shows each type's share of its side (side totals stay in dollars). */
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
          {shown ? formatMoney(total) : HIDDEN_AMOUNT}
        </span>
      </div>
      {/* One bar per side: each type's share, colour fixed per type, with the key below. */}
      <div className="summary-stack" role="img" aria-label={`${title}: ${list.map((g) => `${g.label} ${pctOf(g.totalCents, total)}`).join(', ')}`}>
        {total > 0 &&
          list
            .filter((g) => g.totalCents > 0)
            .map((g) => <span key={g.key} className="summary-seg" style={{ flexGrow: g.totalCents, background: `var(--seg-${g.key})` }} />)}
      </div>
      <ul className="summary-key">
        {list.map((g) => (
          <li key={g.key}>
            <span className="summary-swatch" style={{ background: `var(--seg-${g.key})` }} aria-hidden="true" />
            <span className="summary-label">{g.label}</span>
            <span className="summary-value">{mode === 'amount' ? (shown ? formatMoney(g.totalCents) : HIDDEN_AMOUNT) : pctOf(g.totalCents, total)}</span>
          </li>
        ))}
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
