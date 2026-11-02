import { useEffect, useRef, useState } from 'react'
import { formatMoney } from '../format'

export interface SankeyNode {
  id: string
  label: string
  /** Shown before the label (e.g. a category emoji). */
  emoji?: string
  cents: number
  /** Visual role: income stream, the total, a spending category, money saved, or money drawn from savings. */
  role: 'income' | 'total' | 'spending' | 'saved' | 'deficit'
}

interface Props {
  left: SankeyNode[]
  center: SankeyNode
  right: SankeyNode[]
  /** Denominator for the "% of income" in labels and tooltips. */
  incomeCents: number
}

const NODE_W = 14
const GAP = 10
/** Each node gets at least this much vertical room so its two-line label never collides. */
const MIN_SLOT = 38
const LABEL_W = 210
const PAD_Y = 8

interface Placed {
  node: SankeyNode
  x: number
  y: number
  h: number
}

interface Link {
  id: string
  from: Placed
  to: Placed
  cents: number
  /** Band edges at each end. */
  y0: number
  y1: number
  h: number
  role: SankeyNode['role']
}

/** Stacks nodes top to bottom: height ∝ value, each in a slot tall enough for its label. */
function column(nodes: SankeyNode[], x: number, scale: number): { placed: Placed[]; height: number } {
  let y = PAD_Y
  const placed = nodes.map((node) => {
    const h = Math.max(2, node.cents * scale)
    const slot = Math.max(h, MIN_SLOT)
    const p = { node, x, y: y + (slot - h) / 2, h }
    y += slot + GAP
    return p
  })
  return { placed, height: y - GAP + PAD_Y }
}

const ribbon = (x0: number, y0: number, x1: number, y1: number, h: number) => {
  const xm = (x0 + x1) / 2
  return `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + h} C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h} Z`
}

/** Income streams → total → spending categories (+ saved), drawn as proportional bands. */
export function Sankey({ left, center, right, incomeCents }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [hover, setHover] = useState<{ link: Link; x: number; y: number } | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(560, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // One scale for every column, sized so the busiest side fits in roughly 420px of bands.
  const total = Math.max(center.cents, 1)
  const scale = Math.max(80, 420 - Math.max(left.length, right.length) * GAP) / total
  const xL = LABEL_W
  const xC = width / 2 - NODE_W / 2
  const xR = width - LABEL_W - NODE_W
  const L = column(left, xL, scale)
  const R = column(right, xR, scale)
  const height = Math.max(L.height, R.height, total * scale + 2 * PAD_Y)
  const centerH = total * scale
  const C: Placed = { node: center, x: xC, y: (height - centerH) / 2, h: centerH }

  // Bands leave each node from its top down, and enter the center in the same order.
  const links: Link[] = []
  let cy = C.y
  for (const p of L.placed) {
    const h = p.node.cents * scale
    links.push({ id: `l-${p.node.id}`, from: p, to: C, cents: p.node.cents, y0: p.y, y1: cy, h, role: p.node.role })
    cy += h
  }
  cy = C.y
  for (const p of R.placed) {
    const h = p.node.cents * scale
    links.push({ id: `r-${p.node.id}`, from: C, to: p, cents: p.node.cents, y0: cy, y1: p.y, h, role: p.node.role })
    cy += h
  }

  const pct = (c: number) => (incomeCents > 0 ? `${Math.round((c / incomeCents) * 100)}%` : '')
  const linkClass = (l: Link) => `sankey-link ${l.role}${hover && hover.link.id !== l.id ? ' dim' : ''}${hover?.link.id === l.id ? ' active' : ''}`
  const describe = (l: Link) => {
    const n = l.from.node.role === 'total' ? l.to.node : l.from.node
    const share = pct(l.cents)
    return `${n.emoji ? `${n.emoji} ` : ''}${n.label}: ${formatMoney(l.cents)}${share ? ` (${share} of income)` : ''}`
  }

  return (
    <div className="sankey" ref={box}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Cash flow diagram: income streams on the left flow into categories on the right">
        {links.map((l) => (
          <path
            key={l.id}
            className={linkClass(l)}
            d={ribbon(l.from.x + NODE_W, l.y0, l.to.x, l.y1, l.h)}
            tabIndex={0}
            aria-label={describe(l)}
            onPointerMove={(e) => {
              const r = box.current!.getBoundingClientRect()
              setHover({ link: l, x: e.clientX - r.left, y: e.clientY - r.top })
            }}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover({ link: l, x: ((l.from.x + l.to.x) / 2 / width) * (box.current?.clientWidth ?? width), y: ((l.y0 + l.y1) / 2 / height) * (box.current?.clientHeight ?? height) })}
            onBlur={() => setHover(null)}
          />
        ))}
        {[...L.placed, C, ...R.placed].map((p) => (
          <rect key={`n-${p.node.id}`} className={`sankey-node ${p.node.role}`} x={p.x} y={p.y} width={NODE_W} height={p.h} rx="3" />
        ))}
        {L.placed.map((p) => (
          <text key={`t-${p.node.id}`} className="sankey-label" x={p.x - 8} y={p.y + p.h / 2} textAnchor="end">
            <tspan x={p.x - 8} dy="-0.3em" className="name">
              {p.node.emoji ? `${p.node.emoji} ` : ''}
              {p.node.label.length > 26 ? `${p.node.label.slice(0, 25)}…` : p.node.label}
            </tspan>
            <tspan x={p.x - 8} dy="1.25em" className="amount">
              {formatMoney(p.node.cents)}
            </tspan>
          </text>
        ))}
        {R.placed.map((p) => (
          <text key={`t-${p.node.id}`} className="sankey-label" x={p.x + NODE_W + 8} y={p.y + p.h / 2}>
            <tspan x={p.x + NODE_W + 8} dy="-0.3em" className="name">
              {p.node.emoji ? `${p.node.emoji} ` : ''}
              {p.node.label.length > 26 ? `${p.node.label.slice(0, 25)}…` : p.node.label}
            </tspan>
            <tspan x={p.x + NODE_W + 8} dy="1.25em" className="amount">
              {formatMoney(p.node.cents)}
              {pct(p.node.cents) && ` · ${pct(p.node.cents)}`}
            </tspan>
          </text>
        ))}
        <text className="sankey-label center" x={C.x + NODE_W / 2} y={Math.max(14, C.y - 10)} textAnchor="middle">
          <tspan className="name">{center.label}</tspan>
          <tspan className="amount" dx="6">
            {formatMoney(center.cents)}
          </tspan>
        </text>
      </svg>
      {hover && (
        <div className="chart-tooltip" style={{ left: Math.min(hover.x + 14, width - 220), top: hover.y + 14 }} role="status">
          {describe(hover.link)}
        </div>
      )}
    </div>
  )
}
