import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { Account, Business, BusinessSummary, CashAdjustment, CollectibleItem, Expense, Payout, Sale, Trade } from '../../api/types'
import { formatDate, formatMoney } from '../../format'
import { EXPENSE_LABELS, KIND_LABELS } from '../../lib/businessLabels'
import { PERIODS, periodRange, type Period } from '../../lib/money'
import { Segmented } from '../Segmented'
import { BusinessDialog, CashDialog, ExpenseDialog, ItemDialog, PayoutDialog, SaleDialog, TradeDialog } from './forms'

type Tab = 'inventory' | 'sales' | 'trades' | 'expenses' | 'payouts' | 'cash' | 'accounts'
type StatusFilter = 'in_stock' | 'sold' | 'traded' | 'all'
type DialogState =
  | { kind: 'rename' }
  | { kind: 'item'; item?: CollectibleItem }
  | { kind: 'sale'; items: CollectibleItem[] }
  | { kind: 'trade'; given: CollectibleItem[] }
  | { kind: 'expense' }
  | { kind: 'cash' }
  | { kind: 'payout' }
  | null

interface Props {
  business: Business
  businesses: Business[]
  accounts: Account[]
  onAccountsChanged: () => Promise<void>
  onRenamed: (b: Business) => void
  onDeleted: () => void
}

interface Records {
  summary: BusinessSummary
  items: CollectibleItem[]
  sales: Sale[]
  trades: Trade[]
  expenses: Expense[]
  cash: CashAdjustment[]
  payouts: Payout[]
}

const paidLabel = (v: string | null) => (v === 'cash' ? 'Cash' : v === 'bank' ? 'Bank' : '—')

export function BusinessDetail({ business, businesses, accounts, onAccountsChanged, onRenamed, onDeleted }: Props) {
  const collectibles = business.kind === 'collectibles'
  const [period, setPeriod] = useState<Period>('this-month')
  const [records, setRecords] = useState<{ key: string; data: Records } | null>(null)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(collectibles ? 'inventory' : 'sales')
  const [filter, setFilter] = useState<StatusFilter>('in_stock')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dialog, setDialog] = useState<DialogState>(null)

  const { start, end } = periodRange(period)
  const key = `${business.id}:${start}:${end}:${version}`
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let cancelled = false
    const id = business.id
    Promise.all([
      api.businessSummary(id, start, end),
      collectibles ? api.businessItems(id) : Promise.resolve([]),
      api.sales(id),
      collectibles ? api.trades(id) : Promise.resolve([]),
      api.expenses(id),
      api.cash(id),
      api.payouts(id),
    ]).then(
      ([summary, items, sales, trades, expenses, cash, payouts]) => {
        if (cancelled) return
        setRecords({ key, data: { summary, items, sales, trades, expenses, cash, payouts } })
        setError(null)
      },
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [business.id, collectibles, start, end, key, accounts])

  const data = records?.data
  const stale = records?.key !== key
  const items = useMemo(() => data?.items ?? [], [data])
  const shownItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(
      (i) =>
        (filter === 'all' || i.status === filter) &&
        (!q || [i.name, i.category, i.condition, i.notes].some((f) => f?.toLowerCase().includes(q))),
    )
  }, [items, filter, search])
  const selectedItems = items.filter((i) => selected.has(i.id) && i.status === 'in_stock')

  const afterSave = () => {
    setSelected(new Set())
    reload()
  }
  const run = async (action: () => Promise<void>) => {
    try {
      await action()
      reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const tabs: { value: Tab; label: string }[] = collectibles
    ? [
        { value: 'inventory', label: 'Inventory' },
        { value: 'sales', label: 'Sales' },
        { value: 'trades', label: 'Trades' },
        { value: 'expenses', label: 'Expenses' },
        { value: 'payouts', label: 'Payouts' },
        { value: 'cash', label: 'Cash' },
        { value: 'accounts', label: 'Bank accounts' },
      ]
    : [
        { value: 'sales', label: 'Income' },
        { value: 'expenses', label: 'Expenses' },
        { value: 'payouts', label: 'Payouts' },
        { value: 'cash', label: 'Cash' },
        { value: 'accounts', label: 'Bank accounts' },
      ]

  const s = data?.summary
  const unrealized = s ? s.inventory_value_cents - s.inventory_cost_cents : 0
  const totalAssets = s ? s.cash_on_hand_cents + s.bank_cents + s.inventory_value_cents : 0
  const maxCategory = Math.max(1, ...(s?.expenses_by_category.map((c) => c.amount_cents) ?? []))

  return (
    <div className="business-detail">
      <div className="business-header">
        <div>
          <h2>{business.name}</h2>
          <span className="muted">{KIND_LABELS[business.kind]}</span>
        </div>
        <div className="panel-controls">
          <button className="button small primary" onClick={() => setDialog({ kind: 'payout' })}>
            Pay yourself
          </button>
          <button className="button small" onClick={() => setDialog({ kind: 'rename' })}>
            Rename
          </button>
          <button
            className="button small danger"
            onClick={() => {
              if (window.confirm(`Delete ${business.name} and all of its inventory, sales, trades, expenses and cash records? This can't be undone.`))
                void api.deleteBusiness(business.id).then(onDeleted, (e: Error) => setError(e.message))
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {error && (
        <div className="banner error" role="alert">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {!data ? (
        <p className="empty">Loading…</p>
      ) : (
        <div className={`business-body${stale ? ' stale' : ''}`}>
          <div className="stat-tiles">
            <section className="panel stat-tile">
              <span className="label">Business assets</span>
              <span className="value">{formatMoney(totalAssets)}</span>
              <span className="muted">cash, bank{collectibles ? ' and inventory value' : ''}</span>
            </section>
            <section className="panel stat-tile">
              <span className="label">Cash on hand</span>
              <span className={`value${s!.cash_on_hand_cents < 0 ? ' negative' : ''}`}>{formatMoney(s!.cash_on_hand_cents)}</span>
              <button className="link-button left" onClick={() => setDialog({ kind: 'cash' })}>
                Adjust cash
              </button>
            </section>
            <section className="panel stat-tile">
              <span className="label">Bank accounts</span>
              <span className="value">{formatMoney(s!.bank_cents)}</span>
              <span className="muted">{accounts.filter((a) => a.business_id === business.id).length} linked</span>
            </section>
            {collectibles && (
              <section className="panel stat-tile">
                <span className="label">Inventory (est. value)</span>
                <span className="value">{formatMoney(s!.inventory_value_cents)}</span>
                <span className="muted">
                  {s!.inventory_count} item{s!.inventory_count === 1 ? '' : 's'} · cost {formatMoney(s!.inventory_cost_cents)} ·{' '}
                  {unrealized >= 0 ? '+' : '−'}
                  {formatMoney(Math.abs(unrealized))} unrealized
                </span>
              </section>
            )}
          </div>

          <section className="panel profit-panel">
            <div className="panel-header">
              <h2 className="heading-with-total">
                Profit
                <span className="heading-total">{PERIODS.find((p) => p.value === period)?.label.toLowerCase()}</span>
              </h2>
              <select className="select" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="profit-columns">
              <dl className="ledger">
                <div>
                  <dt>{collectibles ? 'Sales' : 'Income'}</dt>
                  <dd>{formatMoney(s!.sales_cents)}</dd>
                </div>
                {s!.trade_gain_cents > 0 && (
                  <div>
                    <dt>Cash gained in trades</dt>
                    <dd>{formatMoney(s!.trade_gain_cents)}</dd>
                  </div>
                )}
                {collectibles && (
                  <div>
                    <dt>Cost of items sold</dt>
                    <dd>−{formatMoney(s!.cost_of_sold_cents)}</dd>
                  </div>
                )}
                <div>
                  <dt>Sale fees &amp; shipping</dt>
                  <dd>−{formatMoney(s!.selling_costs_cents)}</dd>
                </div>
                <div>
                  <dt>Expenses</dt>
                  <dd>−{formatMoney(s!.expenses_cents)}</dd>
                </div>
                <div className="ledger-total">
                  <dt>{s!.profit_cents < 0 ? 'Loss' : 'Profit'}</dt>
                  <dd className={s!.profit_cents < 0 ? 'negative' : ''}>{formatMoney(s!.profit_cents)}</dd>
                </div>
                <div className="ledger-note">
                  <dt>Paid to you</dt>
                  <dd>{formatMoney(s!.payouts_cents)}</dd>
                </div>
              </dl>
              <div>
                <h3 className="small-heading">Expenses by category</h3>
                {s!.expenses_by_category.length === 0 ? (
                  <p className="muted-text">No expenses in this period.</p>
                ) : (
                  <ul className="category-bars">
                    {s!.expenses_by_category.map((c) => (
                      <li key={c.category}>
                        <span className="summary-label">{EXPENSE_LABELS[c.category]}</span>
                        <span className="summary-track" aria-hidden="true">
                          <span className="summary-bar liability" style={{ width: `${(c.amount_cents / maxCategory) * 100}%` }} />
                        </span>
                        <span className="summary-value">{formatMoney(c.amount_cents)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="tab-bar">
              <Segmented label="Records" options={tabs} value={tab} onChange={setTab} />
            </div>

            {tab === 'inventory' && (
              <>
                <div className="toolbar">
                  <input className="input search" type="search" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search items" />
                  <Segmented
                    label="Status"
                    options={[
                      { value: 'in_stock', label: 'In stock' },
                      { value: 'sold', label: 'Sold' },
                      { value: 'traded', label: 'Traded' },
                      { value: 'all', label: 'All' },
                    ]}
                    value={filter}
                    onChange={setFilter}
                  />
                  <span className="toolbar-spacer" />
                  <button className="button small" disabled={selectedItems.length === 0} onClick={() => setDialog({ kind: 'sale', items: selectedItems })}>
                    Sell{selectedItems.length ? ` ${selectedItems.length}` : ''}
                  </button>
                  <button className="button small" onClick={() => setDialog({ kind: 'trade', given: selectedItems })}>
                    Trade{selectedItems.length ? ` ${selectedItems.length}` : ''}
                  </button>
                  <button className="button small primary" onClick={() => setDialog({ kind: 'item' })}>
                    Add item
                  </button>
                </div>
                {shownItems.length === 0 ? (
                  <p className="empty compact">{items.length === 0 ? 'No items yet. Add what you have in stock.' : 'No items match.'}</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th aria-label="Select" />
                          <th>Item</th>
                          <th>Acquired</th>
                          <th className="amount">Cost</th>
                          <th className="amount">Est. value</th>
                          <th>Status</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {shownItems.map((i) => (
                          <tr key={i.id} className={selected.has(i.id) ? 'selected' : undefined}>
                            <td>
                              {i.status === 'in_stock' && (
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${i.name}`}
                                  checked={selected.has(i.id)}
                                  onChange={() => {
                                    const next = new Set(selected)
                                    if (next.has(i.id)) next.delete(i.id)
                                    else next.add(i.id)
                                    setSelected(next)
                                  }}
                                />
                              )}
                            </td>
                            <td>
                              <span className="account-name">{i.name}</span>
                              <span className="muted">{[i.category, i.condition].filter(Boolean).join(' · ') || '—'}</span>
                            </td>
                            <td>
                              {formatDate(i.acquired_date)}
                              <span className="muted">{i.acquired_via === 'purchase' ? `Bought · ${paidLabel(i.purchase_paid_via)}` : i.acquired_via === 'trade' ? 'Trade-in' : 'Other'}</span>
                            </td>
                            <td className="amount">{formatMoney(i.cost_cents)}</td>
                            <td className="amount">{formatMoney(i.estimated_value_cents)}</td>
                            <td>
                              {i.status === 'in_stock' ? 'In stock' : i.status === 'sold' ? `Sold ${formatMoney(i.sale_price_cents)}` : 'Traded away'}
                            </td>
                            <td className="row-actions">
                              <button className="button small" onClick={() => setDialog({ kind: 'item', item: i })}>
                                Edit
                              </button>
                              {i.status === 'in_stock' && i.acquired_via !== 'trade' && (
                                <button
                                  className="button small danger"
                                  onClick={() => window.confirm(`Delete ${i.name}?`) && void run(() => api.deleteItem(business.id, i.id))}
                                >
                                  Delete
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {tab === 'sales' && (
              <>
                <div className="toolbar">
                  <span className="muted-text">
                    {collectibles ? 'To sell inventory, select items on the Inventory tab. Use this for sales of things not in inventory.' : 'Money your business earned.'}
                  </span>
                  <span className="toolbar-spacer" />
                  <button className="button small primary" onClick={() => setDialog({ kind: 'sale', items: [] })}>
                    {collectibles ? 'Record other sale' : 'Add income'}
                  </button>
                </div>
                <RecordTable
                  empty={collectibles ? 'No sales yet.' : 'No income yet.'}
                  money={2}
                  head={['Date', collectibles ? 'Items' : 'Description', 'Where', 'Paid to', 'Price', 'Fees & shipping']}
                  rows={data.sales.map((x) => ({
                    id: x.id,
                    cells: [
                      formatDate(x.date),
                      x.item_count ? x.item_names : x.notes ?? 'Income',
                      x.channel ?? '—',
                      paidLabel(x.paid_via),
                      formatMoney(x.total_cents),
                      formatMoney(x.fees_cents + x.shipping_cents),
                    ],
                    action: { label: 'Undo', confirm: 'Undo this sale? Its items go back in stock.', run: () => run(() => api.deleteSale(business.id, x.id)) },
                  }))}
                />
              </>
            )}

            {tab === 'trades' && (
              <>
                <div className="toolbar">
                  <span className="muted-text">Select items you're giving on the Inventory tab first, or record a trade where you add only cash.</span>
                  <span className="toolbar-spacer" />
                  <button className="button small primary" onClick={() => setDialog({ kind: 'trade', given: selectedItems })}>
                    Record trade
                  </button>
                </div>
                <RecordTable
                  empty="No trades yet."
                  money={3}
                  head={['Date', 'Gave', 'Received', 'Cash in', 'Cash out', 'Profit']}
                  rows={data.trades.map((x) => ({
                    id: x.id,
                    cells: [formatDate(x.date), x.given_names ?? '—', x.received_names ?? '—', formatMoney(x.cash_in_cents), formatMoney(x.cash_out_cents), formatMoney(x.gain_cents)],
                    action: {
                      label: 'Undo',
                      confirm: 'Undo this trade? Items you gave come back and items you received are removed.',
                      run: () => run(() => api.deleteTrade(business.id, x.id)),
                    },
                  }))}
                />
              </>
            )}

            {tab === 'expenses' && (
              <>
                <div className="toolbar">
                  <span className="muted-text">Supplies, table fees, postage and other costs.</span>
                  <span className="toolbar-spacer" />
                  <button className="button small primary" onClick={() => setDialog({ kind: 'expense' })}>
                    Add expense
                  </button>
                </div>
                <RecordTable
                  empty="No expenses yet."
                  money={1}
                  head={['Date', 'Category', 'Description', 'Paid with', 'Amount']}
                  rows={data.expenses.map((x) => ({
                    id: x.id,
                    cells: [formatDate(x.date), EXPENSE_LABELS[x.category], x.description ?? '—', paidLabel(x.paid_via), formatMoney(x.amount_cents)],
                    action: { label: 'Delete', confirm: 'Delete this expense?', run: () => run(() => api.deleteExpense(business.id, x.id)) },
                  }))}
                />
              </>
            )}

            {tab === 'payouts' && (
              <>
                <div className="toolbar">
                  <span className="muted-text">Money you took out for yourself. Only payouts count as your personal income in Cash flow.</span>
                  <span className="toolbar-spacer" />
                  <button className="button small primary" onClick={() => setDialog({ kind: 'payout' })}>
                    Pay yourself
                  </button>
                </div>
                <RecordTable
                  empty="No payouts yet."
                  money={1}
                  head={['Date', 'Description', 'Paid from', 'Amount']}
                  rows={data.payouts.map((x) => ({
                    id: x.id,
                    cells: [formatDate(x.date), x.description ?? '—', paidLabel(x.paid_via), formatMoney(x.amount_cents)],
                    action: { label: 'Delete', confirm: 'Delete this payout?', run: () => run(() => api.deletePayout(business.id, x.id)) },
                  }))}
                />
              </>
            )}

            {tab === 'cash' && (
              <>
                <div className="toolbar">
                  <span className="muted-text">
                    Cash on hand is {formatMoney(s!.cash_on_hand_cents)}: these adjustments plus cash sales, purchases, trades, expenses and payouts.
                  </span>
                  <span className="toolbar-spacer" />
                  <button className="button small primary" onClick={() => setDialog({ kind: 'cash' })}>
                    Adjust cash
                  </button>
                </div>
                <RecordTable
                  empty="No cash adjustments yet. Add your starting cash to begin."
                  money={1}
                  head={['Date', 'Description', 'Amount']}
                  rows={data.cash.map((x) => ({
                    id: x.id,
                    cells: [formatDate(x.date), x.description ?? '—', `${x.amount_cents >= 0 ? '+' : '−'}${formatMoney(Math.abs(x.amount_cents))}`],
                    action: { label: 'Delete', confirm: 'Delete this cash adjustment?', run: () => run(() => api.deleteCash(business.id, x.id)) },
                  }))}
                />
              </>
            )}

            {tab === 'accounts' && (
              <div className="business-picker">
                <p className="muted-text">
                  Link bank or card accounts this business uses. Their balances count toward its assets, and their spending is left out of your
                  personal Spending chart.
                </p>
                {accounts.length === 0 ? (
                  <p className="empty compact">Connect a bank first.</p>
                ) : (
                  <ul>
                    {accounts.map((a) => {
                      const other = a.business_id != null && a.business_id !== business.id ? businesses.find((b) => b.id === a.business_id) : null
                      return (
                        <li key={a.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={a.business_id === business.id}
                              onChange={() =>
                                void run(async () => {
                                  await api.setAccountBusiness(a.id, a.business_id === business.id ? null : business.id)
                                  await onAccountsChanged()
                                })
                              }
                            />
                            <span>
                              <span className="account-name">{a.name}</span>
                              <span className="muted">
                                {a.institution_name ?? a.subtype ?? a.type}
                                {a.mask ? ` ••${a.mask}` : ''}
                                {other ? ` · linked to ${other.name}` : ''}
                              </span>
                            </span>
                            <span className="link-balance">{formatMoney(a.current_balance_cents, a.currency)}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {dialog?.kind === 'rename' && <BusinessDialog business={business} onClose={() => setDialog(null)} onSaved={onRenamed} />}
      {dialog?.kind === 'item' && <ItemDialog businessId={business.id} item={dialog.item} onClose={() => setDialog(null)} onSaved={afterSave} />}
      {dialog?.kind === 'sale' && <SaleDialog businessId={business.id} items={dialog.items} onClose={() => setDialog(null)} onSaved={afterSave} />}
      {dialog?.kind === 'trade' && <TradeDialog businessId={business.id} given={dialog.given} onClose={() => setDialog(null)} onSaved={afterSave} />}
      {dialog?.kind === 'expense' && <ExpenseDialog businessId={business.id} onClose={() => setDialog(null)} onSaved={afterSave} />}
      {dialog?.kind === 'cash' && <CashDialog businessId={business.id} onClose={() => setDialog(null)} onSaved={afterSave} />}
      {dialog?.kind === 'payout' && <PayoutDialog businessId={business.id} onClose={() => setDialog(null)} onSaved={afterSave} />}
    </div>
  )
}

interface Row {
  id: number
  cells: (string | null)[]
  action: { label: string; confirm: string; run: () => Promise<void> }
}

/** A simple list of records; the last `money` columns are right-aligned amounts. */
function RecordTable({ head, rows, empty, money }: { head: string[]; rows: Row[]; empty: string; /** Trailing money columns. */ money: number }) {
  if (rows.length === 0) return <p className="empty compact">{empty}</p>
  const moneyFrom = head.length - money
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={i >= moneyFrom ? 'amount' : undefined}>
                {h}
              </th>
            ))}
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {r.cells.map((c, i) => (
                <td key={i} className={i >= moneyFrom ? 'amount' : undefined}>
                  {c ?? '—'}
                </td>
              ))}
              <td className="row-actions">
                <button className="button small" onClick={() => window.confirm(r.action.confirm) && void r.action.run()}>
                  {r.action.label}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
