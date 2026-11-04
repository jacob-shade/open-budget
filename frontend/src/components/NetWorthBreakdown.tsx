import { useEffect, useMemo, useRef, useState } from 'react'
import type { NetWorthPoint } from '../api/types'
import { formatMoney } from '../format'

export type BreakdownScale = 'monthly' | 'quarterly' | 'yearly'

/** How many periods each scale shows (yearly: everything available). */
const LIMIT: Record<BreakdownScale, number> = { monthly: 12, quarterly: 12, yearly: Infinity }

interface Period {
  key: string
  label: string
  /** Long form for the tooltip and table. */
  title: string
  /** The last day of the period with data (today for the current period). */
  date: string
  assets: number
  debts: number
  net: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** End-of-period snapshots (points are daily, oldest first). */
function periods(points: NetWorthPoint[], scale: BreakdownScale): Period[] {
  const out: Period[] = []
  for (const p of points) {
    const y = Number(p.date.slice(0, 4))
    const m = Number(p.date.slice(5, 7))
    const q = Math.ceil(m / 3)
    const key = scale === 'monthly' ? `${y}-${m}` : scale === 'quarterly' ? `${y}-Q${q}` : `${y}`
    const label = scale === 'monthly' ? MONTHS.at(m - 1)! : scale === 'quarterly' ? `Q${q} ’${String(y).slice(2)}` : String(y)
    const title = scale === 'monthly' ? `${MONTHS.at(m - 1)} ${y}` : scale === 'quarterly' ? `Q${q} ${y}` : String(y)
    const period = { key, label, title, date: p.date, assets: p.assets_cents, debts: p.debts_cents, net: p.net_worth_cents }
    if (out.at(-1)?.key === key) out[out.length - 1] = period
    else out.push(period)
  }
  const shown = out.slice(-LIMIT[scale])
  // Monthly labels: add the year where it changes so a 12-month run across January reads clearly.
  if (scale === 'monthly') shown.forEach((p, i) => i > 0 && p.key.endsWith('-1') && (p.label = `Jan ’${p.key.slice(2, 4)}`))
  return shown
}

/** A round step (1, 2, 2.5 or 5 × a power of ten) of at least `v`. */
function niceStep(v: number): number {
  if (v <= 0) return 10000
  const p = 10 ** Math.floor(Math.log10(v))
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p
}

const dollars = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: 'compact' })
const axisMoney = (cents: number) => dollars.format(Math.round(cents / 100))

const HEIGHT = 280
const M = { top: 14, right: 16, bottom: 28, left: 64 }

/** Assets (above zero) and debts (below) at the end of each period, with net worth as dots. */
export function NetWorthBreakdown({ points, scale }: { points: NetWorthPoint[]; scale: BreakdownScale }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [hover, setHover] = useState<number | null>(null)
  const data = useMemo(() => periods(points, scale), [points, scale])
  const n = data.length
  const hasData = n > 0

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
    // The frame only exists once there's data, so attach when it appears.
  }, [hasData])
  if (n === 0) return <p className="empty">No history yet.</p>

  const maxUp = Math.max(...data.map((p) => Math.max(p.assets, p.net)), 0)
  const maxDown = Math.max(...data.map((p) => Math.max(p.debts, -p.net)), 0)
  const step = niceStep(Math.max(maxUp + maxDown, 10000) / 5)
  const yMax = Math.max(Math.ceil(maxUp / step) * step, step)
  const yMin = -Math.ceil(maxDown / step) * step
  const ticks = Array.from({ length: Math.round((yMax - yMin) / step) + 1 }, (_, i) => yMin + i * step)

  const innerW = width - M.left - M.right
  const innerH = HEIGHT - M.top - M.bottom
  const slot = innerW / n
  const barW = Math.min(44, slot * 0.6)
  const cx = (i: number) => M.left + slot * (i + 0.5)
  const y = (c: number) => M.top + ((yMax - c) / (yMax - yMin)) * innerH
  const zero = y(0)
  const netPath = data.map((p, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(p.net).toFixed(1)}`).join('')
  const h = hover != null ? data[hover] : null

  return (
    <>
      <div className="chart-legend" aria-hidden="true">
        <span>
          <svg width="12" height="12">
            <rect width="12" height="12" rx="2" fill="var(--positive)" />
          </svg>
          Assets
        </span>
        <span>
          <svg width="12" height="12">
            <rect width="12" height="12" rx="2" fill="var(--negative)" />
          </svg>
          Debts
        </span>
        <span>
          <svg width="18" height="10">
            <line x1="1" y1="5" x2="17" y2="5" stroke="var(--text)" strokeWidth="2" />
            <circle cx="9" cy="5" r="3.5" fill="var(--text)" />
          </svg>
          Net worth
        </span>
      </div>
      <div className="chart-frame" ref={box}>
        <svg
          width="100%"
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`Assets and debts at the end of each ${scale === 'monthly' ? 'month' : scale === 'quarterly' ? 'quarter' : 'year'}. Use left and right arrow keys to read each one.`}
          tabIndex={0}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(n - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault()
            setHover(Math.min(n - 1, Math.max(0, (hover ?? n - 1) + (e.key === 'ArrowRight' ? 1 : -1))))
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--muted)' : 'var(--border)'} strokeWidth="1" />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="axis-label">
                {axisMoney(t)}
              </text>
            </g>
          ))}
          {data.map((p, i) => (
            <g key={p.key} opacity={hover != null && hover !== i ? 0.45 : 1}>
              {p.assets > 0 && <rect x={cx(i) - barW / 2} y={y(p.assets)} width={barW} height={zero - y(p.assets)} rx="3" fill="var(--positive)" />}
              {p.debts > 0 && <rect x={cx(i) - barW / 2} y={zero} width={barW} height={y(-p.debts) - zero} rx="3" fill="var(--negative)" />}
              <text x={cx(i)} y={HEIGHT - 8} textAnchor="middle" className="axis-label">
                {p.label}
              </text>
            </g>
          ))}
          <path d={netPath} fill="none" stroke="var(--text)" strokeWidth="2" strokeLinejoin="round" pointerEvents="none" />
          {data.map((p, i) => (
            <circle key={p.key} cx={cx(i)} cy={y(p.net)} r="4" fill="var(--text)" stroke="var(--surface)" strokeWidth="2" pointerEvents="none" />
          ))}
          {/* Hit areas: the whole column, so the pointer doesn't have to land on a bar. */}
          {data.map((p, i) => (
            <rect key={p.key} x={M.left + slot * i} y={M.top} width={slot} height={innerH} fill="transparent" onPointerEnter={() => setHover(i)} />
          ))}
        </svg>
        {h && (
          <div className="chart-tooltip" style={cx(hover!) > width / 2 ? { right: width - cx(hover!) + 16 } : { left: cx(hover!) + 16 }} role="status">
            <div className="tip-row">
              <strong>{h.title}</strong>
            </div>
            <div className="tip-row">
              <span className="muted">Assets</span>
              <strong>{formatMoney(h.assets)}</strong>
            </div>
            <div className="tip-row">
              <span className="muted">Debts</span>
              <strong>{formatMoney(h.debts)}</strong>
            </div>
            <div className="tip-row">
              <span className="muted">Net worth</span>
              <strong>{formatMoney(h.net)}</strong>
            </div>
          </div>
        )}
      </div>
      <details className="chart-table">
        <summary>View as table</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{scale === 'monthly' ? 'Month' : scale === 'quarterly' ? 'Quarter' : 'Year'}</th>
                <th className="amount">Assets</th>
                <th className="amount">Debts</th>
                <th className="amount">Net worth</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((p) => (
                <tr key={p.key}>
                  <td>{p.title}</td>
                  <td className="amount">{formatMoney(p.assets)}</td>
                  <td className="amount">{formatMoney(p.debts)}</td>
                  <td className="amount">{formatMoney(p.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  )
}
