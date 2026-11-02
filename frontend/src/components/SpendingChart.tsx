import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { api } from '../api/client'
import type { DailySpending } from '../api/types'

type Comparison = 'this-vs-last' | 'last-vs-prior'

const COMPARISONS: { value: Comparison; label: string }[] = [
  { value: 'this-vs-last', label: 'This month vs last month' },
  { value: 'last-vs-prior', label: 'Last month vs the month before' },
]

interface Month {
  year: number
  /** 0-based */
  month: number
  days: number
  start: string
  end: string
  short: string
  long: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Month `offset` months from the one containing `today` (local time). */
function monthAt(today: Date, offset: number): Month {
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const year = first.getFullYear()
  const month = first.getMonth()
  const days = new Date(year, month + 1, 0).getDate()
  return {
    year,
    month,
    days,
    start: `${year}-${pad(month + 1)}-01`,
    end: `${year}-${pad(month + 1)}-${pad(days)}`,
    short: first.toLocaleString(undefined, { month: 'short' }),
    long: first.toLocaleString(undefined, { month: 'long' }),
  }
}

/** Running total for each day of `m` (index 0 = day 1), from the daily rows. */
function cumulative(rows: DailySpending[], m: Month): number[] {
  const byDay = new Array<number>(m.days).fill(0)
  for (const r of rows) {
    if (r.date >= m.start && r.date <= m.end) byDay[Number(r.date.slice(8)) - 1] += r.spent_cents
  }
  let total = 0
  return byDay.map((v) => (total += v))
}

const dollars = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const money = (cents: number) => dollars.format(Math.round(cents / 100))

/** A round axis maximum at or above `v` (1, 2, 2.5 or 5 × a power of ten). */
function niceMax(v: number): number {
  if (v <= 0) return 10000
  const p = 10 ** Math.floor(Math.log10(v))
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p
}

const HEIGHT = 220
const M = { top: 12, right: 16, bottom: 28, left: 56 }

interface Props {
  /** Changes when transactions are re-synced, so the chart refetches. */
  refreshKey: unknown
}

/** Cumulative spending through the month, compared with the previous month. */
export function SpendingChart({ refreshKey }: Props) {
  const [comparison, setComparison] = useState<Comparison>('this-vs-last')
  const [result, setResult] = useState<{ key: string; rows: DailySpending[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hoverDay, setHoverDay] = useState<number | null>(null)
  const [width, setWidth] = useState(600)
  const box = useRef<HTMLDivElement>(null)

  const [today] = useState(() => new Date())
  const isThisMonth = comparison === 'this-vs-last'
  const current = monthAt(today, isThisMonth ? 0 : -1)
  const previous = monthAt(today, isThisMonth ? -1 : -2)
  /** Last day with data for the current series (today, or the whole month). */
  const upTo = isThisMonth ? today.getDate() : current.days
  // Always fetch through the end of this month, so the header's "this month" total is available
  // whichever comparison is selected.
  const thisMonth = monthAt(today, 0)
  const requestKey = `${previous.start}:${thisMonth.end}`

  useEffect(() => {
    let cancelled = false
    api.dailySpending(previous.start, thisMonth.end).then(
      (rows) => {
        if (cancelled) return
        setResult({ key: requestKey, rows })
        setError(null)
      },
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [previous.start, thisMonth.end, requestKey, refreshKey])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rows = useMemo(() => result?.rows ?? [], [result])
  const stale = result?.key !== requestKey
  const cur = useMemo(() => cumulative(rows, current).slice(0, upTo), [rows, current, upTo])
  const prev = useMemo(() => cumulative(rows, previous), [rows, previous])

  const maxDays = Math.max(current.days, previous.days)
  const innerW = width - M.left - M.right
  const innerH = HEIGHT - M.top - M.bottom
  const yMax = niceMax(Math.max(...cur, ...prev, 0))
  const x = (day: number) => M.left + ((day - 1) / (maxDays - 1)) * innerW
  const y = (cents: number) => M.top + innerH - (cents / yMax) * innerH
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)} ${y(v).toFixed(1)}`).join('')
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax)
  const xTicks = [1, 8, 15, 22, 29].filter((d) => d <= maxDays)

  const spentSoFar = cur.at(-1) ?? 0
  const thisMonthTotal = useMemo(() => cumulative(rows, thisMonth)[today.getDate() - 1] ?? 0, [rows, thisMonth, today])
  const prevSameDay = prev[Math.min(upTo, previous.days) - 1] ?? 0
  const diff = spentSoFar - prevSameDay

  const dayFromPointer = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * width
    const day = Math.round(((px - M.left) / innerW) * (maxDays - 1)) + 1
    return Math.min(maxDays, Math.max(1, day))
  }
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const from = hoverDay ?? upTo
    setHoverDay(Math.min(maxDays, Math.max(1, from + (e.key === 'ArrowRight' ? 1 : -1))))
  }

  const tipCur = hoverDay != null && hoverDay <= cur.length ? cur[hoverDay - 1] : null
  const tipPrev = hoverDay != null && hoverDay <= previous.days ? prev[hoverDay - 1] : null
  const tipLeft = hoverDay != null ? x(hoverDay) : 0

  return (
    <section className="panel spending">
      <div className="panel-header">
        <h2 className="heading-with-total">
          Spending
          {result && <span className="heading-total">{money(thisMonthTotal)} this month</span>}
        </h2>
        <select
          className="select"
          value={comparison}
          onChange={(e) => {
            setComparison(e.target.value as Comparison)
            setHoverDay(null)
          }}
          aria-label="Compare"
        >
          {COMPARISONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="empty">Couldn't load spending: {error}</p>
      ) : (
        <>
          <div className="spending-summary">
            <span className="value">{money(spentSoFar)}</span>
            <span className="muted">
              spent in {current.long}
              {isThisMonth ? ' so far' : ''}
              {result && (
                <>
                  {' · '}
                  {diff === 0
                    ? `same as ${previous.long}`
                    : `${money(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than ${previous.long}${isThisMonth ? ' by this day' : ''}`}
                </>
              )}
            </span>
          </div>

          <div className="chart-legend" aria-hidden="true">
            <span>
              <svg width="18" height="8">
                <line x1="1" y1="4" x2="17" y2="4" stroke="var(--chart-current)" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {current.long}
            </span>
            <span>
              <svg width="18" height="8">
                <line
                  x1="1"
                  y1="4"
                  x2="17"
                  y2="4"
                  stroke="var(--chart-previous)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              {previous.long}
            </span>
          </div>

          <div className={`chart-frame${stale ? ' stale' : ''}`} ref={box}>
            <svg
              width="100%"
              viewBox={`0 0 ${width} ${HEIGHT}`}
              role="img"
              aria-label={`Cumulative spending: ${money(spentSoFar)} in ${current.long}${isThisMonth ? ' so far' : ''}, compared with ${previous.long}. Use left and right arrow keys to read each day.`}
              tabIndex={0}
              onPointerMove={(e) => setHoverDay(dayFromPointer(e))}
              onPointerLeave={() => setHoverDay(null)}
              onFocus={() => setHoverDay(upTo)}
              onBlur={() => setHoverDay(null)}
              onKeyDown={onKeyDown}
            >
              {yTicks.map((t) => (
                <g key={t}>
                  <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
                  <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="axis-label">
                    {money(t)}
                  </text>
                </g>
              ))}
              {xTicks.map((d) => (
                <text key={d} x={x(d)} y={HEIGHT - 8} textAnchor="middle" className="axis-label">
                  {d}
                </text>
              ))}

              <path d={path(prev)} fill="none" stroke="var(--chart-previous)" strokeWidth="2" strokeLinejoin="round" />
              <path d={path(cur)} fill="none" stroke="var(--chart-current)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {cur.length > 0 && (
                <circle cx={x(cur.length)} cy={y(spentSoFar)} r="4" fill="var(--chart-current)" stroke="var(--surface)" strokeWidth="2" />
              )}

              {hoverDay != null && (
                <g pointerEvents="none">
                  <line x1={tipLeft} x2={tipLeft} y1={M.top} y2={M.top + innerH} stroke="var(--muted)" strokeWidth="1" />
                  {tipPrev != null && <circle cx={tipLeft} cy={y(tipPrev)} r="4" fill="var(--chart-previous)" stroke="var(--surface)" strokeWidth="2" />}
                  {tipCur != null && <circle cx={tipLeft} cy={y(tipCur)} r="4" fill="var(--chart-current)" stroke="var(--surface)" strokeWidth="2" />}
                </g>
              )}
            </svg>

            {hoverDay != null && (
              <div
                className="chart-tooltip"
                style={tipLeft > width / 2 ? { right: width - tipLeft + 12 } : { left: tipLeft + 12 }}
                role="status"
              >
                <div className="tip-row">
                  <svg width="14" height="6" aria-hidden="true">
                    <line x1="1" y1="3" x2="13" y2="3" stroke="var(--chart-current)" strokeWidth="2" />
                  </svg>
                  <strong>{tipCur != null ? money(tipCur) : '—'}</strong>
                  <span className="muted">
                    {current.short} {hoverDay}
                  </span>
                </div>
                <div className="tip-row">
                  <svg width="14" height="6" aria-hidden="true">
                    <line x1="1" y1="3" x2="13" y2="3" stroke="var(--chart-previous)" strokeWidth="2" />
                  </svg>
                  <strong>{tipPrev != null ? money(tipPrev) : '—'}</strong>
                  <span className="muted">
                    {previous.short} {hoverDay}
                  </span>
                </div>
              </div>
            )}
          </div>
          <p className="chart-note muted">
            Running total by day of the month. Transfers, card and loan payments, and income aren't counted as spending.
          </p>

          <details className="chart-table">
            <summary>View as table</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th className="amount">{current.long}</th>
                    <th className="amount">{previous.long}</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: maxDays }, (_, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td className="amount">{i < cur.length ? money(cur[i]) : '—'}</td>
                      <td className="amount">{i < prev.length ? money(prev[i]) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  )
}
