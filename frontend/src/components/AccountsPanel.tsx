import type { Account, Item } from '../api/types'
import { formatMoney, formatRelative } from '../format'
import { PlaidLinkButton } from './PlaidLinkButton'

interface Props {
  items: Item[]
  accounts: Account[]
  selectedAccountId: string | null
  onSelectAccount: (id: string | null) => void
  onRemoveItem: (id: string) => void
  onReconnected: (message: string) => void
  onError: (message: string) => void
}

function signedBalance(a: Account): number {
  const balance = a.current_balance_cents ?? 0
  return a.is_liability ? -balance : balance
}

export function AccountsPanel({ items, accounts, selectedAccountId, onSelectAccount, onRemoveItem, onReconnected, onError }: Props) {
  const assets = accounts.filter((a) => !a.is_liability).reduce((s, a) => s + signedBalance(a), 0)
  const liabilities = accounts.filter((a) => a.is_liability).reduce((s, a) => s + signedBalance(a), 0)

  return (
    <section className="panel">
      <div className="net-worth">
        <span className="label">Net worth</span>
        <span className="value">{formatMoney(assets + liabilities)}</span>
        <div className="breakdown">
          <span>Assets {formatMoney(assets)}</span>
          <span>Liabilities {formatMoney(-liabilities)}</span>
        </div>
      </div>

      {items.length === 0 && <p className="empty">No banks connected yet.</p>}

      {items.map((item) => {
        const itemAccounts = accounts.filter((a) => a.item_id === item.id)
        return (
          <div key={item.id} className="institution">
            <div className="institution-header">
              <div>
                <h3>{item.institution_name ?? 'Unknown institution'}</h3>
                <span className="muted">Synced {formatRelative(item.last_synced_at)}</span>
              </div>
              <div className="institution-actions">
                <PlaidLinkButton itemId={item.id} label="Reconnect" className="button small" onLinked={onReconnected} onError={onError} />
                <button
                  className="button small danger"
                  onClick={() => {
                    if (window.confirm(`Disconnect ${item.institution_name ?? 'this bank'} and delete its data?`)) onRemoveItem(item.id)
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
            <ul className="account-list">
              {itemAccounts.map((a) => (
                <li key={a.id}>
                  <button
                    className={`account-row ${selectedAccountId === a.id ? 'selected' : ''}`}
                    onClick={() => onSelectAccount(selectedAccountId === a.id ? null : a.id)}
                  >
                    <span>
                      <span className="account-name">{a.name}</span>
                      <span className="muted">
                        {a.subtype ?? a.type}
                        {a.mask ? ` ••${a.mask}` : ''}
                      </span>
                    </span>
                    <span className={a.is_liability ? 'negative' : ''}>{formatMoney(a.current_balance_cents, a.currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
