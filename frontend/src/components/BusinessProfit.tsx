import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { BusinessSummary } from '../api/types'
import { formatMoney } from '../format'
import { PERIODS, periodRange, type Period } from '../lib/money'
import { Link } from './Link'

interface Props {
  onError: (message: string) => void
  /** Changes when data is re-synced, so the totals refetch. */
  refreshKey: unknown
}

/** Overview box: profit across all businesses = revenue − costs, plus what the businesses hold. */
export function BusinessProfit({ onError, refreshKey }: Props) {
  const [period, setPeriod] = useState<Period>('this-month')
  const [state, setState] = useState<{ key: string; count: number; data: BusinessSummary | null } | null>(null)
  const { start, end } = periodRange(period)
  const key = `${start}:${end}`

  useEffect(() => {
    let cancelled = false
    Promise.all([api.businesses(), api.allBusinessSummary(start, end)]).then(
      ([list, data]) => !cancelled && setState({ key, count: list.length, data }),
      (e: Error) => !cancelled && onError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [start, end, key, refreshKey, onError])

  const d = state?.data
  const revenue = d ? d.sales_cents + d.trade_gain_cents : 0
  const costs = d ? d.cost_of_sold_cents + d.selling_costs_cents + d.expenses_cents : 0
  const scale = Math.max(revenue, costs, 1)
  const pct = (cents: number) => `${(cents / scale) * 100}%`

  return (
    <section className="panel business">
      <div className="panel-header">
        <h2>Business profit</h2>
        <div className="panel-controls">
          <Link className="button small" href="/business">
            Open
          </Link>
          {state?.count ? (
            <select className="select" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {state && state.count === 0 ? (
        <p className="empty compact">
          No businesses yet. <Link href="/business">Add a business</Link> to track inventory, sales, trades and expenses.
        </p>
      ) : (
        <div className={state?.key !== key ? 'stale' : undefined}>
          <div className="box-total">
            <span className={`value${d && d.profit_cents < 0 ? ' negative' : ''}`}>{d ? formatMoney(d.profit_cents) : '—'}</span>
            <span className="muted">
              {d && d.profit_cents < 0 ? 'loss' : 'profit'} · {PERIODS.find((p) => p.value === period)?.label.toLowerCase()}
              {state && state.count > 1 ? ` · ${state.count} businesses` : ''}
            </span>
          </div>
          {d && (
            <div className="profit-bars" role="img" aria-label={`Revenue ${formatMoney(revenue)} minus costs ${formatMoney(costs)} equals ${formatMoney(d.profit_cents)}`}>
              <div className="profit-row">
                <span className="profit-label">Revenue</span>
                <span className="profit-track">
                  <span className="profit-bar revenue" style={{ width: pct(revenue) }} />
                </span>
                <span className="profit-amount">{formatMoney(revenue)}</span>
              </div>
              <div className="profit-row">
                <span className="profit-label">Costs</span>
                <span className="profit-track">
                  <span className="profit-bar expenses" style={{ width: pct(costs) }} />
                </span>
                <span className="profit-amount">−{formatMoney(costs)}</span>
              </div>
              <div className="profit-row total">
                <span className="profit-label">Profit</span>
                <span className="profit-track" />
                <span className={`profit-amount${d.profit_cents < 0 ? ' negative' : ''}`}>{formatMoney(d.profit_cents)}</span>
              </div>
            </div>
          )}
          {d && (
            <p className="chart-note muted">
              Costs are items sold at cost {formatMoney(d.cost_of_sold_cents)}, fees &amp; shipping {formatMoney(d.selling_costs_cents)} and expenses{' '}
              {formatMoney(d.expenses_cents)}. Holding {formatMoney(d.cash_on_hand_cents)} cash and {formatMoney(d.inventory_value_cents)} in inventory.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
