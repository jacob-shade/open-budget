import { useMemo, type ReactNode } from 'react'
import type { Category, Transaction } from '../api/types'
import { formatMoney } from '../format'
import { CategoryPicker } from './CategoryPicker'

interface Props {
  transactions: Transaction[]
  title: string
  /** Optional control shown at the right of the header (e.g. "View all"). */
  action?: ReactNode
  /** With these, each category can be changed from its row. */
  categories?: Category[]
  onCategoryChange?: (t: Transaction, categoryId: number | null) => void
  onManageCategories?: () => void
}

interface Day {
  date: string
  /** Net of the day's transactions: negative = spent, positive = gained. */
  totalCents: number
  transactions: Transaction[]
}

/** Groups transactions (newest first) by date, keeping their order. */
function groupByDay(transactions: Transaction[]): Day[] {
  const days: Day[] = []
  for (const t of transactions) {
    const last = days.at(-1)
    if (last && last.date === t.date) {
      last.transactions.push(t)
      last.totalCents += t.amount_cents
    } else {
      days.push({ date: t.date, totalCents: t.amount_cents, transactions: [t] })
    }
  }
  return days
}

const pad = (n: number) => String(n).padStart(2, '0')
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** "Today", "Yesterday", or e.g. "Saturday, Oct 31, 2026" (dates are calendar dates, read as local). */
function dayLabel(iso: string): string {
  const now = new Date()
  if (iso === isoOf(now)) return 'Today'
  if (iso === isoOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
}

/** Transactions grouped by day: a date row with the day's net total, then that day's transactions. */
export function TransactionsTable({ transactions, title, action, categories, onCategoryChange, onManageCategories }: Props) {
  const days = useMemo(() => groupByDay(transactions), [transactions])
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        {action}
      </div>
      {transactions.length === 0 ? (
        <p className="empty">No transactions yet. Connect a bank, then Sync.</p>
      ) : (
        <div className="table-wrap">
          <table className="transactions-by-day">
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Category</th>
                <th>Account</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            {days.map((day) => (
              <tbody key={day.date}>
                <tr className="day-row">
                  <th scope="rowgroup" colSpan={3}>
                    {dayLabel(day.date)}
                    <span className="day-count">
                      {day.transactions.length} transaction{day.transactions.length === 1 ? '' : 's'}
                    </span>
                  </th>
                  <td className={`num day-total${day.totalCents > 0 ? ' positive' : ''}`}>
                    {day.totalCents > 0 ? '+' : ''}
                    {formatMoney(day.totalCents)}
                  </td>
                </tr>
                {day.transactions.map((t) => (
                  <tr key={t.id} className={t.pending ? 'pending' : ''}>
                    <td>
                      <div className="merchant">
                        {t.logo_url ? <img src={t.logo_url} alt="" /> : <span className="logo-fallback">{(t.merchant_name ?? t.name).charAt(0)}</span>}
                        <span>
                          {t.merchant_name ?? t.name}
                          {t.pending && <span className="tag">Pending</span>}
                        </span>
                      </div>
                    </td>
                    <td>
                      {categories && onCategoryChange ? (
                        <CategoryPicker transaction={t} categories={categories} onPick={(id) => onCategoryChange(t, id)} onManage={() => onManageCategories?.()} />
                      ) : (
                        <span className="category-label">
                          <span aria-hidden="true">{t.category_emoji}</span> {t.category_name}
                        </span>
                      )}
                    </td>
                    <td className="muted">{t.account_name}</td>
                    <td className={`num ${t.amount_cents > 0 ? 'positive' : ''}`}>
                      {t.amount_cents > 0 ? '+' : ''}
                      {formatMoney(t.amount_cents, t.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </section>
  )
}
