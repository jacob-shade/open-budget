import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { api } from '../api/client'
import type { NetWorthPoint } from '../api/types'
import { formatMoney } from '../format'
import { HIDDEN_AMOUNT, useAmountsShown } from '../lib/privacy'
import { NetWorthToggle } from './NetWorthToggle'
import { NetWorthBreakdown, type BreakdownScale } from './NetWorthBreakdown'
import { Segmented } from './Segmented'

type Range = '1m' | '3m' | '6m' | '1y' | 'all'

const RANGES: { value: Range; label: string; days: number | null; phrase: string }[] = [
  { value: '1m', label: '1M', days: 30, phrase: 'past month' },
  { value: '3m', label: '3M', days: 91, phrase: 'past 3 months' },
  { value: '6m', label: '6M', days: 182, phrase: 'past 6 months' },
  { value: '1y', label: '1Y', days: 365, phrase: 'past year' },
  { value: 'all', label: 'All', days: null, phrase: 'all time' },
]

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** Calendar date from YYYY-MM-DD, in local time. */
const parse = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))

const dollars = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const axisMoney = (cents: number) => dollars.format(Math.round(cents / 100))

/** A round step (1, 2, 2.5 or 5 × a power of ten) of at least `v`. */
function niceStep(v: number): number {
  if (v <= 0) return 10000
  const p = 10 ** Math.floor(Math.log10(v))
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p
}

type View = 'performance' | 'breakdown'

const SCALES: { value: BreakdownScale; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
]

const HEIGHT = 240
const M = { top: 12, right: 16, bottom: 28, left: 72 }

/** Full-width estimated net worth over time. */
export function NetWorthChart({ refreshKey }: { refreshKey: unknown }) {
  const [today] = useState(() => new Date())
  const [range, setRange] = useState<Range>('3m')
  const [view, setView] = useState<View>('performance')
  const [scale, setScale] = useState<BreakdownScale>('monthly')
  const [result, setResult] = useState<{ key: string; points: NetWorthPoint[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [shown, toggleShown] = useAmountsShown()
  const [width, setWidth] = useState(800)
  const box = useRef<HTMLDivElement>(null)

  const def = RANGES.find((r) => r.value === range)!
  const end = iso(today)
  // Breakdown always uses all history (about 3 years) and groups it by period.
  const start = view === 'performance' && def.days ? iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - def.days)) : null
  const key = `${start ?? 'all'}:${end}`

  useEffect(() => {
    let cancelled = false
    api.netWorthHistory(start, end).then(
      (points) => {
        if (cancelled) return
        setResult({ key, points })
        setError(null)
      },
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [start, end, key, refreshKey])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
    // The frame is re-created when switching back from Breakdown (or after an error), so re-attach.
  }, [view, error])

  const points = useMemo(() => result?.points ?? [], [result])
  const stale = result?.key !== key
  const values = points.map((p) => p.net_worth_cents)
  const n = points.length

  // Y domain: round steps around the data, so the line uses the plot height (net worth rarely nears $0).
  const lo = values.length ? Math.min(...values) : 0
  const hi = values.length ? Math.max(...values) : 0
  const step = niceStep(Math.max(hi - lo, Math.abs(hi) * 0.02, 10000) / 4)
  const yMin = Math.floor(lo / step) * step
  const yMax = Math.max(Math.ceil(hi / step) * step, yMin + step)
  const yTicks = Array.from({ length: Math.round((yMax - yMin) / step) + 1 }, (_, i) => yMin + i * step)

  const innerW = width - M.left - M.right
  const innerH = HEIGHT - M.top - M.bottom
  const x = (i: number) => M.left + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2)
  const y = (c: number) => M.top + innerH - ((c - yMin) / (yMax - yMin)) * innerH
  const linePath = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('')

  const longRange = n > 200
  const tickLabel = (s: string) =>
    parse(s).toLocaleDateString(undefined, longRange ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' })
  const xTickIdx = n > 1 ? [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (n - 1))) : n === 1 ? [0] : []

  const first = values[0] ?? 0
  const last = values.at(-1) ?? 0
  const change = last - first
  const changePct = first > 0 ? (change / first) * 100 : null

  const indexFromPointer = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * width
    return Math.min(n - 1, Math.max(0, Math.round(((px - M.left) / innerW) * (n - 1))))
  }
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const from = hover ?? n - 1
    setHover(Math.min(n - 1, Math.max(0, from + (e.key === 'ArrowRight' ? 1 : -1))))
  }
  const hoverPoint = hover != null ? points[hover] : null
  const tipX = hover != null ? x(hover) : 0

  return (
    <section className="panel net-worth-chart">
      <div className="panel-header">
        <div>
          <h2 className="with-toggle">
            Net worth <NetWorthToggle shown={shown} onToggle={toggleShown} what="net worth" />
          </h2>
          <div className="spending-summary">
            <span className="value">{!result ? '—' : shown ? formatMoney(last) : HIDDEN_AMOUNT}</span>
            {result && n > 1 && shown && view === 'performance' && (
              <span className="muted">
                {change >= 0 ? '+' : '−'}
                {formatMoney(Math.abs(change))}
                {changePct != null && ` (${change >= 0 ? '+' : '−'}${Math.abs(changePct).toFixed(1)}%)`} {def.phrase}
              </span>
            )}
          </div>
        </div>
        <div className="panel-controls">
          <select className="select" value={view} onChange={(e) => setView(e.target.value as View)} aria-label="Chart">
            <option value="performance">Performance</option>
            <option value="breakdown">Breakdown</option>
          </select>
          {view === 'performance' ? (
            <Segmented
              label="Time range"
              options={RANGES}
              value={range}
              onChange={(r) => {
                setRange(r)
                setHover(null)
              }}
            />
          ) : (
            <Segmented label="Breakdown by" options={SCALES} value={scale} onChange={setScale} />
          )}
        </div>
      </div>

      {error ? (
        <p className="empty">Couldn't load net worth history: {error}</p>
      ) : view === 'breakdown' ? (
        <div className={stale ? 'stale' : undefined}>
          <NetWorthBreakdown points={points} scale={scale} />
          <p className="chart-note muted">
            Balances at the end of each period (the current one is as of today), estimated from today&apos;s balances and your transaction history.
            Investments and manual accounts are counted at today&apos;s value.
          </p>
        </div>
      ) : (
        <>
          <div className={`chart-frame${stale ? ' stale' : ''}`} ref={box}>
            <svg
              width="100%"
              viewBox={`0 0 ${width} ${HEIGHT}`}
              role="img"
              aria-label={shown ? `Estimated net worth, ${def.phrase}: ${formatMoney(first)} to ${formatMoney(last)}. Use left and right arrow keys to read each day.` : `Estimated net worth, ${def.phrase}. Use left and right arrow keys to read each day.`}
              tabIndex={0}
              onPointerMove={(e) => n > 0 && setHover(indexFromPointer(e))}
              onPointerLeave={() => setHover(null)}
              onFocus={() => n > 0 && setHover(n - 1)}
              onBlur={() => setHover(null)}
              onKeyDown={onKeyDown}
            >
              {yTicks.map((t) => (
                <g key={t}>
                  <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
                  <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="axis-label">
                    {axisMoney(t)}
                  </text>
                </g>
              ))}
              {xTickIdx.map((i, k) => (
                <text
                  key={i}
                  x={x(i)}
                  y={HEIGHT - 8}
                  textAnchor={k === 0 && n > 1 ? 'start' : k === xTickIdx.length - 1 && n > 1 ? 'end' : 'middle'}
                  className="axis-label"
                >
                  {tickLabel(points[i].date)}
                </text>
              ))}
              <path d={linePath} fill="none" stroke="var(--chart-current)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {n > 0 && <circle cx={x(n - 1)} cy={y(last)} r="4" fill="var(--chart-current)" stroke="var(--surface)" strokeWidth="2" />}
              {hoverPoint && (
                <g pointerEvents="none">
                  <line x1={tipX} x2={tipX} y1={M.top} y2={M.top + innerH} stroke="var(--muted)" strokeWidth="1" />
                  <circle cx={tipX} cy={y(hoverPoint.net_worth_cents)} r="4" fill="var(--chart-current)" stroke="var(--surface)" strokeWidth="2" />
                </g>
              )}
            </svg>
            {hoverPoint && (
              <div className="chart-tooltip" style={tipX > width / 2 ? { right: width - tipX + 12 } : { left: tipX + 12 }} role="status">
                <div className="tip-row">
                  <strong>{formatMoney(hoverPoint.net_worth_cents)}</strong>
                  <span className="muted">{parse(hoverPoint.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
              </div>
            )}
          </div>
          <p className="chart-note muted">
            Estimated from today's balances and your transaction history. Investment balances aren't tracked over time, so they're
            counted at today's value.
          </p>
          <details className="chart-table">
            <summary>View as table</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="amount">Net worth</th>
                  </tr>
                </thead>
                <tbody>
                  {[...points].reverse().map((p) => (
                    <tr key={p.date}>
                      <td>{parse(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="amount">{formatMoney(p.net_worth_cents)}</td>
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
