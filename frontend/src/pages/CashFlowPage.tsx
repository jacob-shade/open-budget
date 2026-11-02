import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { CashFlow } from '../api/types'
import { formatMoney } from '../format'
import { PERIODS, periodRange, type Period } from '../lib/money'
import { Sankey, type SankeyNode } from '../components/Sankey'

/** Streams/categories smaller than this share of the total are folded into "Other" so labels stay readable. */
const MIN_SHARE = 0.025
const MAX_LEFT = 6
const MAX_RIGHT = 9

/** Keeps the largest items and folds the rest into one "Other" node. */
function fold(nodes: SankeyNode[], total: number, max: number, other: Omit<SankeyNode, 'cents'>): SankeyNode[] {
  const keep: SankeyNode[] = []
  let rest = 0
  for (const n of nodes) {
    if (keep.length < max - 1 && n.cents >= total * MIN_SHARE) keep.push(n)
    else rest += n.cents
  }
  if (rest > 0) keep.push({ ...other, cents: rest })
  return keep
}

/** Where personal money came from and which categories it went to, as a Sankey diagram. */
export function CashFlowPage({ refreshKey }: { refreshKey: unknown }) {
  const [period, setPeriod] = useState<Period>('this-month')
  const [result, setResult] = useState<{ key: string; data: CashFlow } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { start, end } = periodRange(period)
  const key = `${start}:${end}`

  useEffect(() => {
    let cancelled = false
    api.cashFlow(start, end).then(
      (data) => {
        if (cancelled) return
        setResult({ key, data })
        setError(null)
      },
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [start, end, key, refreshKey])

  const d = result?.data
  const income = d?.total_income_cents ?? 0
  const spending = d?.total_spending_cents ?? 0
  const net = income - spending
  const total = Math.max(income, spending)

  const left: SankeyNode[] = d
    ? fold(
        d.income.map((i, k) => ({
          id: `${i.source}-${i.business_id ?? i.label}-${k}`,
          label: i.source === 'payout' ? `${i.label} payouts` : i.label,
          emoji: i.source === 'payout' ? '💼' : undefined,
          cents: i.cents,
          role: 'income' as const,
        })),
        total,
        MAX_LEFT,
        { id: 'other-income', label: 'Other income', role: 'income' },
      )
    : []
  if (net < 0) left.push({ id: 'from-savings', label: 'From savings', emoji: '🏦', cents: -net, role: 'deficit' })

  const right: SankeyNode[] = d
    ? fold(
        d.spending.map((c) => ({ id: `cat-${c.category_id}`, label: c.name, emoji: c.emoji, cents: c.cents, role: 'spending' as const })),
        total,
        MAX_RIGHT,
        { id: 'other-spending', label: 'Other categories', emoji: '…', role: 'spending' },
      )
    : []
  if (net > 0) right.push({ id: 'saved', label: 'Saved', emoji: '💰', cents: net, role: 'saved' })

  const periodLabel = PERIODS.find((p) => p.value === period)!.label

  return (
    <main className="cash-flow-page">
      <section className="panel">
        <div className="panel-header">
          <h2 className="heading-with-total">
            Cash flow
            <span className="heading-total">{periodLabel.toLowerCase()}</span>
          </h2>
          <select className="select" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}

        {!d ? (
          <p className="empty">Loading…</p>
        ) : (
          <div className={result.key !== key ? 'stale' : undefined}>
            <div className="flow-stats">
              <div>
                <span className="label">Income</span>
                <span className="value positive">{formatMoney(income)}</span>
              </div>
              <div>
                <span className="label">Spending</span>
                <span className="value">{formatMoney(spending)}</span>
              </div>
              <div>
                <span className="label">{net >= 0 ? 'Saved' : 'Overspent'}</span>
                <span className={`value${net < 0 ? ' negative' : ''}`}>
                  {formatMoney(Math.abs(net))}
                  {income > 0 && (
                    <span className="muted">
                      {' '}
                      {Math.round((Math.abs(net) / income) * 100)}% {net >= 0 ? 'of income' : 'more than income'}
                    </span>
                  )}
                </span>
              </div>
            </div>

            {income === 0 && spending === 0 ? (
              <p className="empty">No income or spending in this period.</p>
            ) : (
              <Sankey left={left} center={{ id: 'total', label: net >= 0 ? 'Income' : 'Income + savings', cents: total, role: 'total' }} right={right} incomeCents={income} />
            )}

            <p className="chart-note muted">
              Personal accounts only. Business income stays within the business; only payouts you record on the Business page count as income
              here. Spending counts Expense categories; transfers and card payments don't count either way.
            </p>

            <details className="chart-table">
              <summary>View as table</summary>
              <div className="flow-tables">
                <table>
                  <thead>
                    <tr>
                      <th>Income stream</th>
                      <th className="amount">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.income.map((i, k) => (
                      <tr key={k}>
                        <td>{i.source === 'payout' ? `💼 ${i.label} payouts` : i.label}</td>
                        <td className="amount">{formatMoney(i.cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th className="amount">Amount</th>
                      <th className="amount">% of income</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.spending.map((c) => (
                      <tr key={c.category_id}>
                        <td>
                          {c.emoji} {c.name}
                        </td>
                        <td className="amount">{formatMoney(c.cents)}</td>
                        <td className="amount">{income > 0 ? `${Math.round((c.cents / income) * 100)}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </section>
    </main>
  )
}
