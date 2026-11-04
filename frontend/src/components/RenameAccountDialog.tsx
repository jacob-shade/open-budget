import { useState } from 'react'
import { api } from '../api/client'
import type { Account } from '../api/types'
import { Dialog, Field } from './Dialog'

/** Rename a linked account. Empty goes back to the name the bank gives it. */
export function RenameAccountDialog({ account, onClose, onSaved }: { account: Account; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(account.name)
  return (
    <Dialog
      title="Rename account"
      submitLabel="Save"
      onClose={onClose}
      onSubmit={async () => {
        await api.renameAccount(account.id, name.trim() || null)
        onSaved()
      }}
    >
      <Field label="Name" hint={`${account.institution_name ?? 'Bank'}${account.mask ? ` ••${account.mask}` : ''}. Leave empty to use the bank's name.`}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
      </Field>
    </Dialog>
  )
}
