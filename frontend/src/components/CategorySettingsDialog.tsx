import { useState } from 'react'
import { api } from '../api/client'
import type { Bucket } from '../api/types'
import { Dialog, Field } from './Dialog'
import { EmojiField } from './ManageCategories'

const GROUPS: { value: Bucket | 'none'; label: string; hint: string }[] = [
  { value: 'fixed', label: '🏠 Fundamentals', hint: 'Bills and essentials' },
  { value: 'future', label: '🌱 Future', hint: 'Saving and investing' },
  { value: 'fun', label: '🎉 Fun', hint: 'Everything you enjoy' },
  { value: 'none', label: 'Not budgeted', hint: 'Card payments and transfers between your accounts' },
]

interface Props {
  category: { id: number; name: string; emoji: string; bucket: Bucket | null; builtin: boolean }
  onClose: () => void
  onSaved: () => void
}

/** Edit a category's emoji, name and budget group, or delete one you created. */
export function CategorySettingsDialog({ category, onClose, onSaved }: Props) {
  const [emoji, setEmoji] = useState(category.emoji)
  const [name, setName] = useState(category.name)
  const [group, setGroup] = useState<Bucket | 'none'>(category.bucket ?? 'none')
  // Delete asks once more in place (no browser popup): first click arms it, second deletes.
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true)
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.deleteCategory(category.id)
      onSaved()
      onClose()
    } catch (e) {
      setDeleteError((e as Error).message)
      setDeleting(false)
    }
  }
  return (
    <Dialog
      title="Category settings"
      submitLabel="Save"
      onClose={onClose}
      canSubmit={name.trim().length > 0 && emoji.length > 0}
      onSubmit={async () => {
        await api.updateCategory(category.id, { name, emoji, bucket: group })
        onSaved()
      }}
      extraAction={
        category.builtin ? null : (
          <button type="button" className="button danger" onClick={() => void remove()} disabled={deleting} onBlur={() => setConfirmDelete(false)}>
            {deleting ? 'Deleting…' : confirmDelete ? 'Click again to delete' : 'Delete'}
          </button>
        )
      }
    >
      {deleteError && (
        <div className="banner error" role="alert">
          {deleteError}
        </div>
      )}
      <div className="category-settings-name">
        <Field label="Icon">
          <EmojiField value={emoji} onChange={setEmoji} label={`Emoji for ${category.name}`} />
        </Field>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
        </Field>
      </div>
      <fieldset className="field">
        <legend className="field-label">Group</legend>
        {GROUPS.map((g) => (
          <label key={g.value} className="radio-card">
            <input type="radio" name="group" value={g.value} checked={group === g.value} onChange={() => setGroup(g.value)} />
            <span>
              <strong>{g.label}</strong>
              <span className="muted">{g.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {confirmDelete && (
        <p className="field-hint" role="status">
          Transactions in {category.name} go back to their automatic category. Its plan is removed.
        </p>
      )}
      {category.builtin && <p className="field-hint">Built-in categories can be renamed or moved, but not deleted. To leave it out of your budget, choose Not budgeted.</p>}
    </Dialog>
  )
}
