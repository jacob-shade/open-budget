import { useState } from 'react'
import { api } from '../../api/client'
import type { Business, BusinessKind, CollectibleItem, ExpenseCategory, PaidVia } from '../../api/types'
import { formatMoney } from '../../format'
import { centsToInput, parseCents, todayIso } from '../../lib/money'
import { allocate, tradeBasis } from '../../lib/collectibles'
import { EXPENSE_LABELS, KIND_LABELS } from '../../lib/businessLabels'
import { Dialog, Field } from '../Dialog'

/** Parses a dollar field or throws a readable error naming the field. */
function cents(label: string, value: string, { allowNegative = false } = {}): number {
  const c = parseCents(value)
  if (c === null) throw new Error(`${label}: enter an amount like 12.50`)
  if (!allowNegative && c < 0) throw new Error(`${label} can't be negative`)
  return c
}

function PaidViaField({ value, onChange, label = 'Paid with' }: { value: PaidVia; onChange: (v: PaidVia) => void; label?: string }) {
  return (
    <Field label={label}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as PaidVia)}>
        <option value="cash">Cash on hand</option>
        <option value="bank">Bank / card</option>
      </select>
    </Field>
  )
}

// ---------- business ----------


export function BusinessDialog({ business, onClose, onSaved }: { business?: Business; onClose: () => void; onSaved: (b: Business) => void }) {
  const [name, setName] = useState(business?.name ?? '')
  const [kind, setKind] = useState<BusinessKind>(business?.kind ?? 'collectibles')
  return (
    <Dialog
      title={business ? 'Rename business' : 'Add a business'}
      submitLabel={business ? 'Save' : 'Add business'}
      onClose={onClose}
      canSubmit={name.trim().length > 0}
      onSubmit={async () => onSaved(business ? await api.renameBusiness(business.id, name) : await api.createBusiness(name, kind))}
    >
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus placeholder="e.g. Jacob's Cards" />
      </Field>
      {!business && (
        <fieldset className="field">
          <legend className="field-label">Business type</legend>
          {(Object.keys(KIND_LABELS) as BusinessKind[]).map((k) => (
            <label key={k} className="radio-card">
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              <span>
                <strong>{KIND_LABELS[k]}</strong>
                <span className="muted">
                  {k === 'collectibles'
                    ? 'Inventory with estimated values, sales, trades, supplies and table expenses, cash on hand.'
                    : 'Income, expenses and cash on hand, without inventory.'}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </Dialog>
  )
}

// ---------- items ----------

export function ItemDialog({ businessId, item, onClose, onSaved }: { businessId: number; item?: CollectibleItem; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [category, setCategory] = useState(item?.category ?? '')
  const [condition, setCondition] = useState(item?.condition ?? '')
  const [date, setDate] = useState(item?.acquired_date ?? todayIso())
  const [via, setVia] = useState<'purchase' | 'other'>(item?.acquired_via === 'other' ? 'other' : 'purchase')
  const [paidVia, setPaidVia] = useState<PaidVia>(item?.purchase_paid_via ?? 'cash')
  const [cost, setCost] = useState(item ? centsToInput(item.cost_cents) : '')
  const [value, setValue] = useState(item ? centsToInput(item.estimated_value_cents) : '')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const fromTrade = item?.acquired_via === 'trade'

  return (
    <Dialog
      title={item ? 'Edit item' : 'Add an item'}
      submitLabel={item ? 'Save' : 'Add item'}
      onClose={onClose}
      canSubmit={name.trim().length > 0}
      onSubmit={async () => {
        const estimated_value_cents = cents('Estimated value', value)
        if (item) {
          await api.updateItem(businessId, item.id, {
            name,
            category,
            condition,
            notes,
            estimated_value_cents,
            ...(fromTrade ? {} : { cost_cents: cents('Cost', cost) }),
          })
        } else {
          await api.createItem(businessId, {
            name,
            category,
            condition,
            notes,
            acquired_date: date,
            acquired_via: via,
            purchase_paid_via: via === 'purchase' ? paidVia : undefined,
            cost_cents: cents('Cost', cost),
            estimated_value_cents,
          })
        }
        onSaved()
      }}
    >
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus placeholder="e.g. Charizard Base Set 4/102" />
      </Field>
      <div className="field-row">
        <Field label="Category">
          <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Pokémon" />
        </Field>
        <Field label="Condition / grade">
          <input className="input" value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="e.g. PSA 9" />
        </Field>
      </div>
      {!item && (
        <div className="field-row">
          <Field label="Acquired">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="How">
            <select className="input" value={via} onChange={(e) => setVia(e.target.value as 'purchase' | 'other')}>
              <option value="purchase">Bought it</option>
              <option value="other">Already owned / gift</option>
            </select>
          </Field>
        </div>
      )}
      <div className="field-row">
        <Field label={via === 'purchase' ? 'What you paid' : 'Cost basis'} hint={fromTrade ? 'Set by the trade it came from.' : undefined}>
          <input className="input money" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" disabled={fromTrade} />
        </Field>
        <Field label="Estimated value">
          <input className="input money" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
        </Field>
      </div>
      {!item && via === 'purchase' && <PaidViaField value={paidVia} onChange={setPaidVia} />}
      <Field label="Notes">
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Dialog>
  )
}

// ---------- sale ----------

export function SaleDialog({
  businessId,
  items,
  onClose,
  onSaved,
}: {
  businessId: number
  /** Items being sold; empty for plain income. */
  items: CollectibleItem[]
  onClose: () => void
  onSaved: () => void
}) {
  const [date, setDate] = useState(todayIso())
  const [total, setTotal] = useState(items.length ? centsToInput(items.reduce((s, i) => s + i.estimated_value_cents, 0)) : '')
  const [fees, setFees] = useState('')
  const [shipping, setShipping] = useState('')
  const [channel, setChannel] = useState('')
  const [paidVia, setPaidVia] = useState<PaidVia>('cash')
  const [notes, setNotes] = useState('')

  const totalCents = parseCents(total) ?? 0
  const shares = allocate(totalCents, items.map((i) => i.estimated_value_cents))
  const costCents = items.reduce((s, i) => s + i.cost_cents, 0)
  const net = totalCents - (parseCents(fees) ?? 0) - (parseCents(shipping) ?? 0) - costCents

  return (
    <Dialog
      title={items.length ? `Sell ${items.length} item${items.length === 1 ? '' : 's'}` : 'Record income'}
      submitLabel="Record sale"
      wide={items.length > 0}
      onClose={onClose}
      canSubmit={total.trim().length > 0}
      onSubmit={async () => {
        await api.createSale(businessId, {
          date,
          item_ids: items.map((i) => i.id),
          total_cents: cents('Sale price', total),
          fees_cents: cents('Fees', fees),
          shipping_cents: cents('Shipping', shipping),
          channel,
          paid_via: paidVia,
          notes,
        })
        onSaved()
      }}
    >
      {items.length > 0 && (
        <table className="mini-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="amount">Est. value</th>
              <th className="amount">Cost</th>
              <th className="amount">Share of price</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, k) => (
              <tr key={i.id}>
                <td>{i.name}</td>
                <td className="amount">{formatMoney(i.estimated_value_cents)}</td>
                <td className="amount">{formatMoney(i.cost_cents)}</td>
                <td className="amount">{formatMoney(shares[k] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="field-row">
        <Field label={items.length ? 'Total sale price' : 'Amount'}>
          <input className="input money" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} autoFocus placeholder="0.00" />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Platform / payment fees">
          <input className="input money" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Shipping you paid">
          <input className="input money" inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0.00" />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Where">
          <input className="input" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="e.g. eBay, card show, local" />
        </Field>
        <PaidViaField label="Paid to" value={paidVia} onChange={setPaidVia} />
      </div>
      <Field label="Notes">
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {items.length > 0 && (
        <p className={`form-summary${net < 0 ? ' negative' : ''}`}>
          Profit on this sale: <strong>{formatMoney(net)}</strong> (price − fees − shipping − cost {formatMoney(costCents)})
        </p>
      )}
    </Dialog>
  )
}

// ---------- trade ----------

interface IncomingRow {
  key: number
  name: string
  category: string
  condition: string
  value: string
}

export function TradeDialog({
  businessId,
  given,
  onClose,
  onSaved,
}: {
  businessId: number
  given: CollectibleItem[]
  onClose: () => void
  onSaved: () => void
}) {
  const [date, setDate] = useState(todayIso())
  const [rows, setRows] = useState<IncomingRow[]>([{ key: 0, name: '', category: '', condition: '', value: '' }])
  const [cashIn, setCashIn] = useState('')
  const [cashOut, setCashOut] = useState('')
  const [paidVia, setPaidVia] = useState<PaidVia>('cash')
  const [notes, setNotes] = useState('')

  const update = (key: number, field: keyof Omit<IncomingRow, 'key'>, v: string) =>
    setRows(rows.map((r) => (r.key === key ? { ...r, [field]: v } : r)))
  const filled = rows.filter((r) => r.name.trim())
  const givenCost = given.reduce((s, i) => s + i.cost_cents, 0)
  const givenValue = given.reduce((s, i) => s + i.estimated_value_cents, 0)
  const receivedValue = filled.reduce((s, r) => s + (parseCents(r.value) ?? 0), 0)
  const basis = tradeBasis(givenCost, parseCents(cashOut) ?? 0, parseCents(cashIn) ?? 0)

  return (
    <Dialog
      title="Record a trade"
      submitLabel="Record trade"
      wide
      onClose={onClose}
      canSubmit={given.length > 0 || filled.length > 0}
      onSubmit={async () => {
        await api.createTrade(businessId, {
          date,
          given_item_ids: given.map((i) => i.id),
          received: filled.map((r) => ({
            name: r.name,
            category: r.category,
            condition: r.condition,
            estimated_value_cents: cents(`Value of ${r.name}`, r.value),
          })),
          cash_in_cents: cents('Cash received', cashIn),
          cash_out_cents: cents('Cash added', cashOut),
          paid_via: paidVia,
          notes,
        })
        onSaved()
      }}
    >
      <h3 className="form-section">You give</h3>
      {given.length === 0 ? (
        <p className="muted-text">No items selected. Select items in your inventory first, or record a trade where you only add cash.</p>
      ) : (
        <ul className="chip-list">
          {given.map((i) => (
            <li key={i.id}>
              {i.name} <span className="muted">{formatMoney(i.estimated_value_cents)}</span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="form-section">You receive</h3>
      {rows.map((r) => (
        <div key={r.key} className="field-row incoming">
          <Field label="Name">
            <input className="input" value={r.name} onChange={(e) => update(r.key, 'name', e.target.value)} placeholder="Card name" />
          </Field>
          <Field label="Category">
            <input className="input" value={r.category} onChange={(e) => update(r.key, 'category', e.target.value)} />
          </Field>
          <Field label="Condition">
            <input className="input" value={r.condition} onChange={(e) => update(r.key, 'condition', e.target.value)} />
          </Field>
          <Field label="Est. value">
            <input className="input money" inputMode="decimal" value={r.value} onChange={(e) => update(r.key, 'value', e.target.value)} placeholder="0.00" />
          </Field>
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${r.name || 'this row'}`}
            onClick={() => setRows(rows.length > 1 ? rows.filter((x) => x.key !== r.key) : [{ ...r, name: '', category: '', condition: '', value: '' }])}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="button small" onClick={() => setRows([...rows, { key: Math.max(...rows.map((r) => r.key)) + 1, name: '', category: '', condition: '', value: '' }])}>
        + Another item
      </button>
      <h3 className="form-section">Cash and details</h3>
      <div className="field-row">
        <Field label="Cash you received">
          <input className="input money" inputMode="decimal" value={cashIn} onChange={(e) => setCashIn(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Cash you added">
          <input className="input money" inputMode="decimal" value={cashOut} onChange={(e) => setCashOut(e.target.value)} placeholder="0.00" />
        </Field>
        <PaidViaField label="Cash moved via" value={paidVia} onChange={setPaidVia} />
      </div>
      <div className="field-row">
        <Field label="Date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Notes">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <p className="form-summary">
        Value given {formatMoney(givenValue)} · value received {formatMoney(receivedValue)}. Received items will cost{' '}
        <strong>{formatMoney(basis.incomingCost)}</strong> in total
        {basis.gain > 0 && (
          <>
            , and <strong>{formatMoney(basis.gain)}</strong> counts as profit now
          </>
        )}
        .
      </p>
    </Dialog>
  )
}

// ---------- expense & cash ----------


export function ExpenseDialog({ businessId, onClose, onSaved }: { businessId: number; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(todayIso())
  const [category, setCategory] = useState<ExpenseCategory>('shipping')
  const [amount, setAmount] = useState('')
  const [paidVia, setPaidVia] = useState<PaidVia>('bank')
  const [description, setDescription] = useState('')
  return (
    <Dialog
      title="Add an expense"
      submitLabel="Add expense"
      onClose={onClose}
      canSubmit={amount.trim().length > 0}
      onSubmit={async () => {
        await api.createExpense(businessId, { date, category, amount_cents: cents('Amount', amount), paid_via: paidVia, description })
        onSaved()
      }}
    >
      <div className="field-row">
        <Field label="Category">
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} autoFocus>
            {(Object.keys(EXPENSE_LABELS) as ExpenseCategory[]).map((c) => (
              <option key={c} value={c}>
                {EXPENSE_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount">
          <input className="input money" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <PaidViaField value={paidVia} onChange={setPaidVia} />
      </div>
      <Field label="Description">
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. 500 toploaders, Collect-A-Con table" />
      </Field>
    </Dialog>
  )
}

export function CashDialog({ businessId, onClose, onSaved }: { businessId: number; onClose: () => void; onSaved: () => void }) {
  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  return (
    <Dialog
      title="Adjust cash on hand"
      submitLabel="Save"
      onClose={onClose}
      canSubmit={amount.trim().length > 0}
      onSubmit={async () => {
        const c = cents('Amount', amount)
        await api.createCash(businessId, { date, amount_cents: direction === 'in' ? c : -c, description })
        onSaved()
      }}
    >
      <Field label="Type">
        <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')} autoFocus>
          <option value="in">Add cash (starting cash, withdrawal for a show)</option>
          <option value="out">Remove cash (bank deposit, personal use)</option>
        </select>
      </Field>
      <div className="field-row">
        <Field label="Amount">
          <input className="input money" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>
      <Field label="Description">
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Starting cash" />
      </Field>
    </Dialog>
  )
}
