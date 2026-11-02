import type { Account, Item } from '../api/types'
import { formatRelative } from '../format'
import { PlaidLinkButton } from './PlaidLinkButton'

interface Props {
  items: Item[]
  accounts: Account[]
  onRemoveItem: (id: string) => void
  onReconnected: (message: string) => void
  onError: (message: string) => void
}

/** Bank connections: last sync, reconnect (Plaid update mode) and remove. */
export function Connections({ items, accounts, onRemoveItem, onReconnected, onError }: Props) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Connections</h2>
      </div>
      {items.length === 0 && <p className="empty compact">No banks connected yet.</p>}
      {items.map((item) => {
        const count = accounts.filter((a) => a.item_id === item.id).length
        return (
          <div key={item.id} className="institution">
            <div className="institution-header">
              <div>
                <h3>{item.institution_name ?? 'Unknown institution'}</h3>
                <span className="muted">
                  {count} account{count === 1 ? '' : 's'} · Synced {formatRelative(item.last_synced_at)}
                </span>
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
          </div>
        )
      })}
    </section>
  )
}
