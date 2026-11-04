import { useState } from 'react'
import { api } from '../api/client'
import type { Account, ManualAccountType } from '../api/types'
import { centsToInput, parseCents } from '../lib/money'
import { Dialog, Field } from './Dialog'

const TYPES: { value: ManualAccountType; label: string }[] = [
  { value: 'depository', label: 'Cash (checking, savings)' },
  { value: 'credit', label: 'Credit card' },
  { value: 'loan', label: 'Loan' },
  { value: 'investment', label: 'Investment' },
  { value: 'other', label: 'Other' },
]

const owes = (t: ManualAccountType) => t === 'credit' || t === 'loan'

interface Props {
  /** Set to edit an existing manual account. */
  account?: Account
  onClose: () => void
  onSaved: () => void
}

/** Add or update an account you track by hand (e.g. a loan Plaid can't connect to). */
export function ManualAccountDialog({ account, onClose, onSaved }: Props) {
  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<ManualAccountType>((account?.type as ManualAccountType) ?? 'loan')
  const [institution, setInstitution] = useState(account?.institution_name ?? '')
  const [subtype, setSubtype] = useState(account?.subtype ?? '')
  const [balance, setBalance] = useState(account?.current_balance_cents != null ? centsToInput(account.current_balance_cents) : '')
  const [rate, setRate] = useState(account?.apy_bps != null ? (account.apy_bps / 100).toFixed(2) : '')
  const [minPayment, setMinPayment] = useState(account?.min_payment_cents != null ? centsToInput(account.min_payment_cents) : '')

  return (
    <Dialog
      title={account ? `Update ${account.name}` : 'Add a manual account'}
      submitLabel={account ? 'Save' : 'Add account'}
      onClose={onClose}
      canSubmit={name.trim().length > 0 && balance.trim().length > 0}
      onSubmit={async () => {
        const cents = parseCents(balance)
        if (cents === null) throw new Error('Balance: enter an amount like 12500.00')
        if (owes(type) && cents < 0) throw new Error('Enter the amount you owe as a positive number')
        const rateText = rate.replace('%', '').trim()
        const ratePct = rateText === '' ? null : Number(rateText)
        if (ratePct !== null && (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100)) throw new Error('Rate: enter a percentage between 0 and 100, like 6.25')
        const minCents = owes(type) && minPayment.trim() !== '' ? parseCents(minPayment) : null
        if (owes(type) && minPayment.trim() !== '' && (minCents === null || minCents < 0)) throw new Error('Minimum payment: enter an amount like 210.00')
        const input = {
          name,
          account_type: type,
          institution_name: institution,
          account_subtype: subtype,
          balance_cents: cents,
          apy_bps: ratePct === null ? null : Math.round(ratePct * 100),
          min_payment_cents: owes(type) ? minCents : null,
        }
        if (account) await api.updateManualAccount(account.id, input)
        else await api.createManualAccount(input)
        onSaved()
      }}
    >
      {!account && <p className="muted-text">For an account Plaid can't connect to. Update its balance whenever you check it.</p>}
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Student loan" autoFocus />
      </Field>
      <div className="field-row">
        <Field label="Type">
          <select className="input" value={type} onChange={(e) => setType(e.target.value as ManualAccountType)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Institution">
          <input className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} maxLength={100} placeholder="e.g. Sallie Mae" />
        </Field>
      </div>
      <div className="field-row">
        <Field label={owes(type) ? 'Amount you owe' : 'Current balance'} hint={owes(type) ? 'Counted as debt in your net worth.' : undefined}>
          <input className="input money" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Kind (optional)">
          <input className="input" value={subtype} onChange={(e) => setSubtype(e.target.value)} maxLength={100} placeholder={owes(type) ? 'e.g. student' : 'e.g. savings'} />
        </Field>
      </div>
      <div className="field-row">
        <Field
          label={owes(type) ? 'Interest rate (APR %)' : 'APY (%)'}
          hint={owes(type) ? undefined : 'Optional. The Budget plans interest from this and counts it as set aside.'}
        >
          <input className="input money" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={owes(type) ? 'e.g. 6.25' : 'e.g. 3.50'} />
        </Field>
        {owes(type) ? (
          <Field label="Minimum monthly payment">
            <input className="input money" inputMode="decimal" value={minPayment} onChange={(e) => setMinPayment(e.target.value)} placeholder="0.00" />
          </Field>
        ) : (
          <span className="field" aria-hidden="true" />
        )}
      </div>
    </Dialog>
  )
}
