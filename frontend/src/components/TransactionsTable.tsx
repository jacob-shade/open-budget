import type { Transaction } from '../api/types'
import { formatCategory, formatDate, formatMoney } from '../format'

interface Props {
  transactions: Transaction[]
  title: string
  onClearFilter?: () => void
}

export function TransactionsTable({ transactions, title, onClearFilter }: Props) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        {onClearFilter && (
          <button className="button small" onClick={onClearFilter}>
            Show all
          </button>
        )}
      </div>
      {transactions.length === 0 ? (
        <p className="empty">No transactions yet. Connect a bank, then Sync.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Merchant</th>
                <th>Category</th>
                <th>Account</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className={t.pending ? 'pending' : ''}>
                  <td className="nowrap">{formatDate(t.date)}</td>
                  <td>
                    <div className="merchant">
                      {t.logo_url ? <img src={t.logo_url} alt="" /> : <span className="logo-fallback">{(t.merchant_name ?? t.name).charAt(0)}</span>}
                      <span>
                        {t.merchant_name ?? t.name}
                        {t.pending && <span className="tag">Pending</span>}
                      </span>
                    </div>
                  </td>
                  <td>{formatCategory(t.category)}</td>
                  <td className="muted">{t.account_name}</td>
                  <td className={`num ${t.amount_cents > 0 ? 'positive' : ''}`}>{formatMoney(t.amount_cents, t.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
