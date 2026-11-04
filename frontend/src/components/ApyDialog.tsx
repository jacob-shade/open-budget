import { useState } from 'react'
import { api } from '../api/client'
import type { Account } from '../api/types'
import { Dialog, Field } from './Dialog'

/** Set the interest rate (APY) for an account; Plaid doesn't report savings rates. */
export function ApyDialog({ account, onClose, onSaved }: { account: Account; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(account.apy_bps != null ? (account.apy_bps / 100).toFixed(2) : '')
  const save = async (bps: number | null) => {
    await api.setAccountApy(account.id, bps)
    onSaved()
  }
  return (
    <Dialog
      title={`Interest rate for ${account.name}`}
      submitLabel="Save"
      onClose={onClose}
      onSubmit={async () => {
        const text = value.replace('%', '').trim()
        if (text === '') return save(null)
        const n = Number(text)
        if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Enter a rate between 0 and 100, like 3.50')
        return save(Math.round(n * 100))
      }}
    >
      <p className="muted-text">
        The Budget plans interest from this account&apos;s balance at the start of each month × the APY ÷ 12, and counts it as set aside in
        Future. Leave empty to stop.
      </p>
      <Field label="APY (%)">
        <input className="input money" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 3.50" autoFocus />
      </Field>
    </Dialog>
  )
}
