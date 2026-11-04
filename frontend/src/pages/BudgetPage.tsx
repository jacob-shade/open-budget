import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { api } from '../api/client'
import type { Bucket, Budget, BudgetPercentages } from '../api/types'
import { formatMoney } from '../format'
import { centsToInput, parseCents } from '../lib/money'
import { CategorySettingsDialog } from '../components/CategorySettingsDialog'
import { Dialog, Field } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { EmojiField } from '../components/ManageCategories'
import { Segmented } from '../components/Segmented'

type Scale = 'month' | 'year' | 'decade'

const SCALES: { value: Scale; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'decade', label: 'Decade' },
]

const BUCKETS: { key: Bucket; label: string; emoji: string; pct: keyof BudgetPercentages; hint: string }[] = [
  { key: 'fixed', label: 'Fundamentals', emoji: '🏠', pct: 'fixed_pct', hint: 'Bills and essentials' },
  { key: 'future', label: 'Future', emoji: '🌱', pct: 'future_pct', hint: 'Saving and investing' },
  { key: 'fun', label: 'Fun', emoji: '🎉', pct: 'fun_pct', hint: 'Everything you enjoy' },
]

const pad = (n: number) => String(n).padStart(2, '0')

/** The period containing `anchor` (a month's first day) at the given scale. */
function periodOf(scale: Scale, anchor: Date) {
  const y = anchor.getFullYear()
  const m = anchor.getMonth()
  if (scale === 'month') {
    const last = new Date(y, m + 1, 0).getDate()
    return { start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-${pad(last)}`, months: 1, label: anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }
  }
  if (scale === 'year') return { start: `${y}-01-01`, end: `${y}-12-31`, months: 12, label: String(y) }
  const d = Math.floor(y / 10) * 10
  return { start: `${d}-01-01`, end: `${d + 9}-12-31`, months: 120, label: `${d}s` }
}

function shift(scale: Scale, anchor: Date, by: number): Date {
  const y = anchor.getFullYear()
  const m = anchor.getMonth()
  if (scale === 'month') return new Date(y, m + by, 1)
  if (scale === 'year') return new Date(y + by, m, 1)
  return new Date(y + by * 10, m, 1)
}

const thisMonth = () => {
  const t = new Date()
  return new Date(t.getFullYear(), t.getMonth(), 1)
}

/** Income planned vs actual, the Fundamentals / Future / Fun split, and which categories sit in each bucket. */
export function BudgetPage({ refreshKey }: { refreshKey: unknown }) {
  const [scale, setScale] = useState<Scale>('month')
  const [anchor, setAnchor] = useState(thisMonth)
  const [result, setResult] = useState<{ key: string; data: Budget } | null>(null)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const period = periodOf(scale, anchor)
  const key = `${period.start}:${period.end}:${version}`
  const reload = () => setVersion((v) => v + 1)

  useEffect(() => {
    let cancelled = false
    api.budget(period.start, period.end).then(
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
  }, [period.start, period.end, key, refreshKey])

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
      reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const current = periodOf(scale, thisMonth()).start === period.start
  const d = result?.data

  return (
    <main className="budget-page">
      <div className="budget-period">
        <Segmented label="Budget period" options={SCALES} value={scale} onChange={setScale} />
        <div className="period-nav">
          <button className="icon-button" onClick={() => setAnchor(shift(scale, anchor, -1))} aria-label={`Previous ${scale}`}>
            ‹
          </button>
          <span className="period-label" aria-live="polite">
            {period.label}
          </span>
          <button className="icon-button" onClick={() => setAnchor(shift(scale, anchor, 1))} aria-label={`Next ${scale}`}>
            ›
          </button>
          {!current && (
            <button className="button small" onClick={() => setAnchor(thisMonth())}>
              {scale === 'month' ? 'This month' : scale === 'year' ? 'This year' : 'This decade'}
            </button>
          )}
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

      {!d ? (
        <p className="empty">Loading…</p>
      ) : (
        <div className={`budget-body${result.key !== key ? ' stale' : ''}`}>
          <IncomeTable
            data={d}
            months={period.months}
            onPlan={(source, label, cents) => run(() => api.setIncomePlan(source, label, cents))}
            onAdded={() => void run(async () => {})}
          />
          <Buckets data={d} months={period.months} onSave={(p) => run(() => api.setBudgetPercentages(p))} />
          <BucketLists data={d} months={period.months} onChange={run} />
        </div>
      )}
    </main>
  )
}

// ---------- income ----------

/** 350 → "3.50%". */
const pct = (bps: number | null) => (bps == null ? '' : `${(bps / 100).toFixed(2)}%`)

/** Explains a calculated interest plan. */
function interestNote(r: Budget['income'][number]) {
  return r.balance_cents != null && r.apy_bps != null
    ? `Calculated: ${formatMoney(r.balance_cents)} balance at the start of the period × ${pct(r.apy_bps)} ÷ 12`
    : 'Calculated from the balance and APY'
}

const interestRows = (data: Budget) => data.income.filter((r) => r.source === 'interest')

function PlannedCell({ value, onSave, label }: { value: number | null; onSave: (cents: number | null) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  // Empty removes the plan; an invalid amount is ignored (the old value comes back).
  const commit = () => {
    if (draft === null) return
    const text = draft.trim()
    setDraft(null)
    if (text === '') {
      if (value !== null) onSave(null)
      return
    }
    const c = parseCents(text)
    if (c !== null && c >= 0 && c !== value) onSave(c)
  }
  return (
    <input
      className="input money planned-input"
      inputMode="decimal"
      aria-label={label}
      placeholder="—"
      value={draft ?? (value != null ? centsToInput(value) : '')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}

function IncomeTable({
  data,
  months,
  onPlan,
  onAdded,
}: {
  data: Budget
  months: number
  onPlan: (source: 'income' | 'payout', label: string, monthlyCents: number | null) => void
  onAdded: () => void
}) {
  const [adding, setAdding] = useState(false)
  const plannedTotal = data.income.reduce((s, r) => s + (r.planned_monthly_cents ?? 0) * months, 0)
  const actualTotal = data.income.reduce((s, r) => s + r.actual_cents, 0)
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="heading-with-total">
          Income
          {months > 1 && <span className="heading-total">planned amounts are per month × {months}</span>}
        </h2>
        <button className="button small" onClick={() => setAdding(true)}>
          Add income
        </button>
      </div>
      <div className="table-wrap">
        <table className="budget-income">
          <thead>
            <tr>
              <th>Income source</th>
              <th className="num">Planned{months > 1 ? ' / month' : ''}</th>
              <th className="num">Actual</th>
              <th className="num">Remaining</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {data.income.length === 0 && (
              <tr>
                <td colSpan={5} className="empty compact">
                  No income yet. Use Add income to plan what you expect.
                </td>
              </tr>
            )}
            {data.income.map((r) => {
              const planned = r.planned_monthly_cents != null ? r.planned_monthly_cents * months : null
              const remaining = planned != null ? planned - r.actual_cents : null
              const name = r.source === 'payout' ? `💼 ${r.label} payouts` : r.source === 'interest' ? `📈 ${r.label} (${pct(r.apy_bps)} APY)` : r.label
              return (
                <tr key={`${r.source}:${r.label}`}>
                  <td>{name}</td>
                  <td className="num">
                    {r.source === 'interest' ? (
                      <span className="computed-plan" title={interestNote(r)}>
                        {r.planned_monthly_cents != null ? formatMoney(r.planned_monthly_cents) : '—'}
                      </span>
                    ) : (
                      <PlannedCell value={r.planned_monthly_cents} label={`Planned per month for ${name}`} onSave={(c) => onPlan(r.source as 'income' | 'payout', r.label, c)} />
                    )}
                  </td>
                  <td className="num">{formatMoney(r.actual_cents)}</td>
                  <td className={`num${remaining != null && remaining < 0 ? ' positive' : ''}`}>
                    {remaining == null ? '—' : remaining < 0 ? `+${formatMoney(-remaining)} over` : formatMoney(remaining)}
                  </td>
                  <td className="row-actions">
                    {/* Removes the plan. A source with income this period stays listed, with its actual amount. */}
                    {r.planned_monthly_cents != null && r.source !== 'interest' && (
                      <button
                        className="icon-button small"
                        onClick={() => onPlan(r.source as 'income' | 'payout', r.label, null)}
                        aria-label={`Remove ${name}`}
                        title={r.actual_cents > 0 ? 'Remove the plan (income received this period still shows)' : 'Remove'}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <th className="num">{formatMoney(plannedTotal)}</th>
              <th className="num">{formatMoney(actualTotal)}</th>
              <th className={`num${plannedTotal - actualTotal < 0 ? ' positive' : ''}`}>
                {plannedTotal - actualTotal < 0 ? `+${formatMoney(actualTotal - plannedTotal)} over` : formatMoney(plannedTotal - actualTotal)}
              </th>
              <th />
            </tr>
          </tfoot>
        </table>
      </div>
      {adding && (
        <AddIncomeDialog existing={data.income.map((r) => r.label)} onClose={() => setAdding(false)} onAdded={onAdded} />
      )}
    </section>
  )
}

/** Modal for a new planned income source. */
function AddIncomeDialog({ existing, onClose, onAdded }: { existing: string[]; onClose: () => void; onAdded: () => void }) {
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const cents = parseCents(amount)
  const taken = existing.some((l) => l.trim().toLowerCase() === label.trim().toLowerCase())
  return (
    <Dialog
      title="Add income source"
      submitLabel="Add"
      onClose={onClose}
      canSubmit={label.trim().length > 0 && cents !== null && cents >= 0 && !taken}
      onSubmit={async () => {
        await api.setIncomePlan('income', label.trim(), cents)
        onAdded()
      }}
    >
      <Field label="Name" hint={taken ? 'There is already an income source with this name. Change its planned amount in the table.' : 'For example your employer, a side job or rental income.'}>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} autoFocus />
      </Field>
      <Field label="Planned per month">
        <input className="input money" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
    </Dialog>
  )
}

// ---------- buckets ----------

/** What bucket targets are a share of: planned income for the period, or actual income if nothing is planned. */
function incomeBase(data: Budget, months: number) {
  const planned = data.income.reduce((s, r) => s + (r.planned_monthly_cents ?? 0) * months, 0)
  const actual = data.income.reduce((s, r) => s + r.actual_cents, 0)
  return { base: planned > 0 ? planned : actual, fromPlan: planned > 0 }
}

function Buckets({ data, months, onSave }: { data: Budget; months: number; onSave: (p: BudgetPercentages) => void }) {
  const [draft, setDraft] = useState<BudgetPercentages | null>(null)
  const pct = draft ?? data.percentages
  const sum = pct.fixed_pct + pct.future_pct + pct.fun_pct
  const changed = draft !== null && (draft.fixed_pct !== data.percentages.fixed_pct || draft.future_pct !== data.percentages.future_pct || draft.fun_pct !== data.percentages.fun_pct)
  const { base, fromPlan } = incomeBase(data, months)
  const spent = (b: Bucket) =>
    data.categories.filter((c) => c.bucket === b).reduce((s, c) => s + c.actual_cents, 0) +
    // Interest stays in the savings account, so it counts as set aside.
    (b === 'future' ? interestRows(data).reduce((s, r) => s + r.actual_cents, 0) : 0)
  const setPct = (k: keyof BudgetPercentages, v: number) => setDraft({ ...pct, [k]: Math.max(0, Math.min(100, Math.round(v) || 0)) })

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="heading-with-total">
          Buckets
          <span className="heading-total">
            {base > 0 ? `of ${formatMoney(base)} ${fromPlan ? 'planned' : 'actual'} income` : 'add planned income to set targets'}
          </span>
        </h2>
        <div className="panel-controls">
          {draft && (
            <span className={`pct-total${sum === 100 ? '' : ' negative'}`} role="status">
              {sum === 100 ? 'Adds up to 100%' : `Adds up to ${sum}% · needs 100%`}
            </span>
          )}
          {changed && (
            <>
              <button className="button small" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button
                className="button small primary"
                disabled={sum !== 100}
                onClick={() => {
                  onSave(pct)
                  setDraft(null)
                }}
              >
                Save split
              </button>
            </>
          )}
        </div>
      </div>
      <div className="bucket-cards">
        {BUCKETS.map((b) => {
          const target = Math.round((base * pct[b.pct]) / 100)
          const actual = spent(b.key)
          const remaining = target - actual
          const share = target > 0 ? Math.min(1, actual / target) : actual > 0 ? 1 : 0
          return (
            <div key={b.key} className={`bucket-card ${b.key}`}>
              <div className="bucket-head">
                <span className="bucket-name">
                  <span aria-hidden="true">{b.emoji}</span> {b.label}
                </span>
                <span className="pct-input">
                  <button className="icon-button small" onClick={() => setPct(b.pct, pct[b.pct] - 5)} aria-label={`Lower ${b.label} by 5%`}>
                    −
                  </button>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    value={pct[b.pct]}
                    onChange={(e) => setPct(b.pct, Number(e.target.value))}
                    aria-label={`${b.label} percent`}
                  />
                  <span aria-hidden="true">%</span>
                  <button className="icon-button small" onClick={() => setPct(b.pct, pct[b.pct] + 5)} aria-label={`Raise ${b.label} by 5%`}>
                    +
                  </button>
                </span>
              </div>
              <span className="muted-text small">{b.hint}</span>
              <div className="bucket-bar" role="progressbar" aria-label={`${b.label} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
                <span className={remaining < 0 ? 'over' : ''} style={{ width: `${share * 100}%` }} />
              </div>
              <dl className="ledger">
                <div>
                  <dt>Target</dt>
                  <dd>{formatMoney(target)}</dd>
                </div>
                <div>
                  <dt>{b.key === 'future' ? 'Set aside' : 'Spent'}</dt>
                  <dd>{formatMoney(actual)}</dd>
                </div>
                <div className="ledger-total">
                  <dt>{remaining < 0 ? 'Over' : 'Remaining'}</dt>
                  <dd className={remaining < 0 ? 'negative' : ''}>{formatMoney(Math.abs(remaining))}</dd>
                </div>
              </dl>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ---------- categories per bucket ----------

function NewCategory({ bucket, onAdd }: { bucket: Bucket; onAdd: (name: string, emoji: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🏷️')
  if (!open)
    return (
      <button className="link-button left" onClick={() => setOpen(true)}>
        + New category
      </button>
    )
  return (
    <form
      className="new-category"
      onSubmit={(e) => {
        e.preventDefault()
        void onAdd(name, emoji).then(() => {
          setName('')
          setEmoji('🏷️')
          setOpen(false)
        })
      }}
    >
      <EmojiField value={emoji} onChange={setEmoji} label="Emoji for the new category" />
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Category name" maxLength={60} autoFocus aria-label={`New ${bucket} category name`} />
      <button className="button small primary" type="submit" disabled={!name.trim() || !emoji}>
        Add
      </button>
      <button className="button small" type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  )
}

/** Remaining for spending: planned − actual; over plan shows as "over". */
function remainingCell(planned: number | null, actual: number) {
  if (planned == null) return <td className="num muted-cell">—</td>
  const r = planned - actual
  return <td className={`num${r < 0 ? ' negative' : ''}`}>{r < 0 ? `${formatMoney(-r)} over` : formatMoney(r)}</td>
}

function BucketLists({ data, months, onChange }: { data: Budget; months: number; onChange: (action: () => Promise<unknown>) => Promise<void> }) {
  const plan = (id: number, cents: number | null) => onChange(() => api.setCategoryPlan(id, cents))
  const { base } = incomeBase(data, months)
  const [settingsFor, setSettingsFor] = useState<Budget['categories'][number] | null>(null)
  const notBudgeted = data.categories.filter((c) => c.bucket === null)
  const perMonth = months > 1 ? ' / month' : ''

  // Dragging a row by its grip: `ids` is the list's order while dragging (and while saving, so it
  // doesn't jump back before the refreshed budget arrives); `id` is the row being moved.
  const [drag, setDrag] = useState<{ ids: number[]; id: number | null } | null>(null)
  const dragStart = useRef<number[]>([])
  const ordered = (list: Budget['categories']) => {
    if (!drag || !list.some((c) => drag.ids.includes(c.id))) return list
    const byId = new Map(list.map((c) => [c.id, c]))
    return drag.ids.flatMap((id) => byId.get(id) ?? [])
  }
  const save = (ids: number[]) => {
    const changed = ids.some((id, i) => id !== dragStart.current[i])
    if (!changed) return setDrag(null)
    setDrag({ ids, id: null })
    void onChange(() => api.reorderCategories(ids)).finally(() => setDrag(null))
  }
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })
  // The row moves in the DOM as you drag, which drops pointer capture, so the move and release are
  // followed on the window. The ref holds the live order for those listeners.
  const live = useRef<{ ids: number[]; id: number; tbody: HTMLElement } | null>(null)
  const startDrag = (e: PointerEvent<HTMLButtonElement>, list: Budget['categories'], id: number) => {
    const tbody = e.currentTarget.closest('tbody')
    if (e.button !== 0 || drag || !tbody) return
    e.preventDefault()
    dragStart.current = list.map((c) => c.id)
    live.current = { ids: dragStart.current, id, tbody }
    setDrag({ ids: dragStart.current, id })
  }
  const dragging = drag?.id != null
  useEffect(() => {
    if (!dragging) return
    const move = (e: globalThis.PointerEvent) => {
      const d = live.current
      if (!d) return
      // The new index is how many of the other rows sit above the pointer.
      const others = [...d.tbody.querySelectorAll<HTMLTableRowElement>('tr[data-cat]')].filter((tr) => Number(tr.dataset.cat) !== d.id)
      const index = others.filter((tr) => {
        const r = tr.getBoundingClientRect()
        return r.top + r.height / 2 < e.clientY
      }).length
      const ids = d.ids.filter((x) => x !== d.id)
      ids.splice(index, 0, d.id)
      if (ids.some((x, i) => x !== d.ids[i])) {
        live.current = { ...d, ids }
        setDrag({ ids, id: d.id })
      }
    }
    const up = () => {
      const d = live.current
      live.current = null
      if (d) saveRef.current(d.ids)
    }
    document.body.classList.add('dragging-rows')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      document.body.classList.remove('dragging-rows')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragging])
  // Keyboard: arrow up/down on the grip moves the row one place and saves.
  const keyMove = (e: KeyboardEvent<HTMLButtonElement>, list: Budget['categories'], id: number) => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || drag) return
    e.preventDefault()
    const ids = list.map((c) => c.id)
    const i = ids.indexOf(id)
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    dragStart.current = list.map((c) => c.id)
    save(ids)
    const button = e.currentTarget
    requestAnimationFrame(() => button.focus())
  }

  const rows = (unordered: Budget['categories']) => {
    const list = ordered(unordered)
    return list.map((c) => {
      const planned = c.planned_monthly_cents != null ? c.planned_monthly_cents * months : null
      return (
        <tr key={c.id} data-cat={c.id} className={`category-row-hover${drag?.id === c.id ? ' dragging' : ''}`}>
          <td>
            <span className="category-cell">
              <button
                type="button"
                className="grip-button"
                onPointerDown={(e) => startDrag(e, list, c.id)}
                onKeyDown={(e) => keyMove(e, list, c.id)}
                aria-label={`Reorder ${c.name}. Use the up and down arrow keys to move it.`}
                title="Drag to reorder"
              >
                <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
                  {[3, 8, 13].flatMap((cy) => [2.5, 7.5].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" fill="currentColor" />))}
                </svg>
              </button>
              <span className="bucket-category">
                <span className="category-option">
                  <span aria-hidden="true">{c.emoji}</span>
                  {c.name}
                </span>
                {c.kind === 'transfer' && <span className="muted">Transfer</span>}
              </span>
              <button type="button" className="icon-button small cog-button" onClick={() => setSettingsFor(c)} aria-label={`Settings for ${c.name}`} title="Category settings">
                <Icon name="cog" size={16} />
              </button>
            </span>
          </td>
          <td className="num">
            <PlannedCell value={c.planned_monthly_cents} label={`Planned per month for ${c.name}`} onSave={(cents) => void plan(c.id, cents)} />
          </td>
          <td className="num">{formatMoney(c.actual_cents)}</td>
          {remainingCell(planned, c.actual_cents)}
        </tr>
      )
    })
  }

  const head = (
    <thead>
      <tr>
        <th>Category</th>
        <th className="num">Planned{perMonth}</th>
        <th className="num">Actual</th>
        <th className="num">Remaining</th>
      </tr>
    </thead>
  )

  return (
    <>
      {BUCKETS.map((b) => {
        const list = data.categories.filter((c) => c.bucket === b.key)
        // Interest on savings is reinvested automatically, so it sits in Future.
        const interest = b.key === 'future' ? interestRows(data) : []
        const plannedTotal =
          list.reduce((s, c) => s + (c.planned_monthly_cents ?? 0) * months, 0) + interest.reduce((s, r) => s + (r.planned_monthly_cents ?? 0) * months, 0)
        const actualTotal = list.reduce((s, c) => s + c.actual_cents, 0) + interest.reduce((s, r) => s + r.actual_cents, 0)
        const anyPlanned = list.some((c) => c.planned_monthly_cents != null) || interest.some((r) => r.planned_monthly_cents != null)
        const target = Math.round((base * data.percentages[b.pct]) / 100)
        return (
          <section key={b.key} className={`panel bucket-list ${b.key}`}>
            <div className="panel-header">
              <h2 className="heading-with-total">
                <span>
                  <span aria-hidden="true">{b.emoji}</span> {b.label}
                </span>
                <span className="heading-total">
                  {list.length} {list.length === 1 ? 'category' : 'categories'}
                  {interest.length > 0 && ` + interest`}
                </span>
              </h2>
              {target > 0 && (
                <span className={`muted-text small${plannedTotal > target ? ' over-plan' : ''}`}>
                  Planned {formatMoney(plannedTotal)} of {formatMoney(target)} target
                  {plannedTotal > target ? ` · ${formatMoney(plannedTotal - target)} over` : ''}
                </span>
              )}
            </div>
            {list.length === 0 && interest.length === 0 ? (
              <p className="empty compact">No categories yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="budget-table">
                  {head}
                  <tbody>
                    {interest.map((r) => {
                      const planned = r.planned_monthly_cents != null ? r.planned_monthly_cents * months : null
                      return (
                        <tr key={`interest:${r.label}`} className="interest-row">
                          <td>
                            <span className="category-cell">
                              <span className="grip-spacer" aria-hidden="true" />
                              <span className="bucket-category">
                                <span className="category-option">
                                  <span aria-hidden="true">📈</span>
                                  {r.label}
                                </span>
                                <span className="muted">Reinvested automatically · {pct(r.apy_bps)} APY</span>
                              </span>
                            </span>
                          </td>
                          <td className="num">
                            <span className="computed-plan" title={interestNote(r)}>
                              {r.planned_monthly_cents != null ? formatMoney(r.planned_monthly_cents) : '—'}
                            </span>
                          </td>
                          <td className="num">{formatMoney(r.actual_cents)}</td>
                          {remainingCell(planned, r.actual_cents)}
                        </tr>
                      )
                    })}
                    {rows(list)}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Total</th>
                      <th className="num">{anyPlanned ? formatMoney(plannedTotal) : '—'}</th>
                      <th className="num">{formatMoney(actualTotal)}</th>
                      {anyPlanned ? (
                        <th className={`num${plannedTotal - actualTotal < 0 ? ' negative' : ''}`}>
                          {plannedTotal - actualTotal < 0 ? `${formatMoney(actualTotal - plannedTotal)} over` : formatMoney(plannedTotal - actualTotal)}
                        </th>
                      ) : (
                        <th className="num">—</th>
                      )}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <NewCategory
              bucket={b.key}
              onAdd={(name, emoji) =>
                // Future is usually money moved to savings/investments, so its new categories are transfers.
                onChange(() => api.createCategory({ name, emoji, kind: b.key === 'future' ? 'transfer' : 'expense', bucket: b.key }))
              }
            />
          </section>
        )
      })}
      {settingsFor && (
        <CategorySettingsDialog category={settingsFor} onClose={() => setSettingsFor(null)} onSaved={() => void onChange(async () => {})} />
      )}
      {notBudgeted.length > 0 && (
        <details className="panel not-budgeted">
          <summary>
            Not budgeted <span className="muted">({notBudgeted.length}: card payments and transfers between your accounts)</span>
          </summary>
          <div className="table-wrap">
            <table className="budget-table">
              {head}
              <tbody>{rows(notBudgeted)}</tbody>
            </table>
          </div>
        </details>
      )}
    </>
  )
}
