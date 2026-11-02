import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import type { Account, Transaction, TransactionSummary } from '../api/types'
import { formatCategory, formatDate, formatMoney } from '../format'
import { CATEGORIES } from '../lib/categories'
import { Icon } from '../components/Icon'
import { Popover } from '../components/Popover'
import { Segmented } from '../components/Segmented'
import { TransactionsTable } from '../components/TransactionsTable'

const PAGE_SIZE = 100

type Preset = 'all' | 'recent' | 'this-month' | 'last-month' | '30d' | '90d' | 'this-year' | 'custom'
const PRESETS: { value: Exclude<Preset, 'custom'>; label: string }[] = [
  { value: 'recent', label: 'This & last month' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'this-year', label: 'This year' },
  { value: 'all', label: 'All dates' },
]
/** The range the page opens with. */
const DEFAULT_PRESET: Preset = 'recent'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const shortDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function presetRange(p: Preset): { start?: string; end?: string } {
  const t = new Date()
  const y = t.getFullYear()
  const m = t.getMonth()
  switch (p) {
    case 'recent':
      return { start: iso(new Date(y, m - 1, 1)), end: iso(t) }
    case 'this-month':
      return { start: iso(new Date(y, m, 1)), end: iso(t) }
    case 'last-month':
      return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) }
    case '30d':
      return { start: iso(new Date(y, m, t.getDate() - 29)), end: iso(t) }
    case '90d':
      return { start: iso(new Date(y, m, t.getDate() - 89)), end: iso(t) }
    case 'this-year':
      return { start: iso(new Date(y, 0, 1)), end: iso(t) }
    default:
      return {}
  }
}

type Direction = 'all' | 'in' | 'out'

interface Props {
  accounts: Account[]
  /** Changes after a sync, so the list refetches. */
  refreshKey: unknown
  /** Header slot the search, date picker and filters render into. */
  headerSlot: HTMLElement | null
}

/** All transactions with search, a date range and filters, fetched from the server page by page. */
export function TransactionsPage({ accounts, refreshKey, headerSlot }: Props) {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [preset, setPreset] = useState<Preset>(DEFAULT_PRESET)
  const [custom, setCustom] = useState<{ start: string; end: string }>({ start: '', end: '' })
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [direction, setDirection] = useState<Direction>('all')
  const [result, setResult] = useState<{ key: string; rows: Transaction[]; done: boolean; summary: TransactionSummary } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const range = preset === 'custom' ? { start: custom.start || undefined, end: custom.end || undefined } : presetRange(preset)
  const query = useMemo(
    () => ({ search, start: range.start, end: range.end, accounts: accountIds, categories, direction }),
    [search, range.start, range.end, accountIds, categories, direction],
  )
  const key = JSON.stringify(query)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.transactions({ ...query, limit: PAGE_SIZE }), api.transactionSummary(query)]).then(
      ([rows, summary]) => {
        if (cancelled) return
        setResult({ key, rows, done: rows.length < PAGE_SIZE, summary })
        setError(null)
      },
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [query, key, refreshKey])

  const loadMore = async () => {
    if (!result) return
    setLoadingMore(true)
    try {
      const more = await api.transactions({ ...query, limit: PAGE_SIZE, offset: result.rows.length })
      setResult({ ...result, rows: [...result.rows, ...more], done: more.length < PAGE_SIZE })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  const filterCount = (accountIds.length ? 1 : 0) + (categories.length ? 1 : 0) + (direction !== 'all' ? 1 : 0)
  const anyActive = filterCount > 0 || preset !== DEFAULT_PRESET || search !== ''
  const rangeLabel =
    preset === 'custom'
      ? custom.start && custom.end
        ? `${shortDate(custom.start)} – ${shortDate(custom.end)}`
        : custom.start
          ? `From ${shortDate(custom.start)}`
          : custom.end
            ? `Until ${shortDate(custom.end)}`
            : 'All dates'
      : PRESETS.find((p) => p.value === preset)!.label
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const clearAll = () => {
    setSearchInput('')
    setSearch('')
    setPreset(DEFAULT_PRESET)
    setCustom({ start: '', end: '' })
    setAccountIds([])
    setCategories([])
    setDirection('all')
  }

  const controls = (
    <div className="transaction-controls">
      <label className="search-box">
        <Icon name="search" size={16} />
        <input type="search" placeholder="Search transactions" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} aria-label="Search transactions" />
      </label>

      <Popover
        active={preset !== DEFAULT_PRESET}
        ariaLabel={`Dates: ${rangeLabel}`}
        label={
          <>
            <Icon name="calendar" size={16} />
            <span>{rangeLabel}</span>
          </>
        }
      >
        {(close) => (
          <div className="date-picker">
            <ul className="preset-list">
              {PRESETS.map((p) => (
                <li key={p.value}>
                  <button
                    className={`preset${preset === p.value ? ' selected' : ''}`}
                    onClick={() => {
                      setPreset(p.value)
                      close()
                    }}
                  >
                    {p.label}
                    {preset === p.value && <span aria-hidden="true">✓</span>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="custom-range">
              <span className="field-label">Custom range</span>
              <div className="field-row">
                <label className="field">
                  <span className="field-hint">From</span>
                  <input
                    className="input"
                    type="date"
                    value={custom.start}
                    max={custom.end || undefined}
                    onChange={(e) => {
                      setCustom({ ...custom, start: e.target.value })
                      setPreset('custom')
                    }}
                  />
                </label>
                <label className="field">
                  <span className="field-hint">To</span>
                  <input
                    className="input"
                    type="date"
                    value={custom.end}
                    min={custom.start || undefined}
                    onChange={(e) => {
                      setCustom({ ...custom, end: e.target.value })
                      setPreset('custom')
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        )}
      </Popover>

      <Popover
        active={filterCount > 0}
        ariaLabel={filterCount ? `Filters (${filterCount} on)` : 'Filters'}
        label={
          <>
            <Icon name="filter" size={16} />
            <span>Filters</span>
            {filterCount > 0 && <span className="badge">{filterCount}</span>}
          </>
        }
      >
        {() => (
          <div className="filter-panel">
            <div className="filter-group">
              <span className="field-label">Type</span>
              <Segmented
                label="Type"
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'out', label: 'Money out' },
                  { value: 'in', label: 'Money in' },
                ]}
                value={direction}
                onChange={setDirection}
              />
            </div>
            <fieldset className="filter-group">
              <legend className="field-label">
                Accounts
                {accountIds.length > 0 && (
                  <button className="link-button" onClick={() => setAccountIds([])}>
                    Clear
                  </button>
                )}
              </legend>
              {accounts.length === 0 && <span className="muted-text">No accounts connected.</span>}
              {accounts.map((a) => (
                <label key={a.id} className="check-row">
                  <input type="checkbox" checked={accountIds.includes(a.id)} onChange={() => setAccountIds(toggle(accountIds, a.id))} />
                  <span>
                    {a.name}
                    <span className="muted">
                      {a.institution_name ?? a.subtype ?? a.type}
                      {a.mask ? ` ••${a.mask}` : ''}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset className="filter-group">
              <legend className="field-label">
                Categories
                {categories.length > 0 && (
                  <button className="link-button" onClick={() => setCategories([])}>
                    Clear
                  </button>
                )}
              </legend>
              <div className="category-checks">
                {CATEGORIES.map((c) => (
                  <label key={c} className="check-row">
                    <input type="checkbox" checked={categories.includes(c)} onChange={() => setCategories(toggle(categories, c))} />
                    <span>{formatCategory(c)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </Popover>
    </div>
  )

  const rows = result?.rows ?? []
  return (
    <main>
      {headerSlot && createPortal(controls, headerSlot)}
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {!result ? (
        <p className="empty">Loading…</p>
      ) : (
        <div className={`transactions-layout${result.key !== key ? ' stale' : ''}`}>
          <div>
            {anyActive && rows.length === 0 ? (
              <section className="panel planned">
                <h2>No transactions match</h2>
                <p className="muted-text">Try a different search, date range or filter.</p>
                <button className="button" onClick={clearAll}>
                  Clear search and filters
                </button>
              </section>
            ) : (
              <TransactionsTable
                transactions={rows}
                title={anyActive ? `${result.summary.count.toLocaleString()} matching · ${rangeLabel}` : rangeLabel}
                action={
                  anyActive && (
                    <button className="button small" onClick={clearAll}>
                      Clear all
                    </button>
                  )
                }
              />
            )}
            {!result.done && rows.length > 0 && (
              <div className="load-more">
                <button className="button" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
          <SummaryBox summary={result.summary} rangeLabel={rangeLabel} />
        </div>
      )}
    </main>
  )
}

/** Totals for everything matching the current search, dates and filters (not just the loaded page). */
function SummaryBox({ summary, rangeLabel }: { summary: TransactionSummary; rangeLabel: string }) {
  const largest = summary.largest_expense
  return (
    <section className="panel transactions-summary" aria-label="Summary">
      <div className="panel-header">
        <h2>Summary</h2>
        <span className="muted-text small">{rangeLabel}</span>
      </div>
      <dl className="ledger">
        <div>
          <dt>Total transactions</dt>
          <dd>{summary.count.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Total spending</dt>
          <dd>{formatMoney(summary.spending_cents)}</dd>
        </div>
        <div>
          <dt>Total income</dt>
          <dd className={summary.income_cents > 0 ? 'positive' : ''}>{formatMoney(summary.income_cents)}</dd>
        </div>
        <div>
          <dt>Average expense</dt>
          <dd>{summary.average_expense_cents != null ? formatMoney(summary.average_expense_cents) : '—'}</dd>
        </div>
        <div className="largest">
          <dt>
            Largest expense
            {largest && (
              <span className="muted">
                {largest.name} · {formatDate(largest.date)}
              </span>
            )}
          </dt>
          <dd>{largest ? formatMoney(largest.amount_cents) : '—'}</dd>
        </div>
      </dl>
      <p className="chart-note muted">Spending, income and expenses leave out transfers and card or loan payments between your accounts.</p>
    </section>
  )
}
