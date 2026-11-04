import { useState } from 'react'
import { api } from '../api/client'
import type { Bucket } from '../api/types'
import { Dialog, Field } from './Dialog'
import { EmojiField } from './ManageCategories'

const GROUPS: { value: Bucket | 'none'; label: string; hint: string }[] = [
  { value: 'fixed', label: '🏠 Fixed', hint: 'Bills and essentials' },
  { value: 'future', label: '🌱 Future', hint: 'Saving and investing' },
  { value: 'fun', label: '🎉 Fun', hint: 'Everything you enjoy' },
  { value: 'none', label: 'Not budgeted', hint: 'Card payments and transfers between your accounts' },
]

interface Props {
  category: { id: number; name: string; emoji: string; bucket: Bucket | null }
  onClose: () => void
  onSaved: () => void
}

/** Edit a category's emoji, name and budget group. */
export function CategorySettingsDialog({ category, onClose, onSaved }: Props) {
  const [emoji, setEmoji] = useState(category.emoji)
  const [name, setName] = useState(category.name)
  const [group, setGroup] = useState<Bucket | 'none'>(category.bucket ?? 'none')
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
    >
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
    </Dialog>
  )
}
