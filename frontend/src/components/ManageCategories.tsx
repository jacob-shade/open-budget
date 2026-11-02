import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Category, CategoryKind } from '../api/types'
import { formatCategory } from '../format'
import { Popover } from './Popover'

const KINDS: { value: CategoryKind; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
]

const SUGGESTED = [
  '🍔', '🍕', '☕', '🍺', '🛒', '🛍️', '🚗', '⛽', '🚌', '✈️', '🏨', '🎬', '🎮', '🎵', '📚', '🏠',
  '💡', '📱', '🔨', '🩺', '💊', '💇', '🏋️', '🐶', '👶', '🎁', '💼', '🃏', '📦', '🏷️', '💰', '💳',
  '🏦', '📥', '📤', '🧾', '❤️', '⭐', '❔', '🧰',
]

/** Pick from common emoji, or type / paste any emoji (the OS picker works too: Win + . or Ctrl + Cmd + Space). */
function EmojiField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="emoji-field">
      <Popover align="left" triggerClassName="emoji-button" ariaLabel={`${label}: ${value || 'none'}. Change emoji`} label={<span aria-hidden="true">{value || '＋'}</span>}>
        {(close) => (
          <div className="emoji-picker">
            <div className="emoji-grid" role="listbox" aria-label="Emoji">
              {SUGGESTED.map((e) => (
                <button
                  key={e}
                  role="option"
                  aria-selected={e === value}
                  className={`emoji-option${e === value ? ' selected' : ''}`}
                  onClick={() => {
                    onChange(e)
                    close()
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
            <label className="field">
              <span className="field-hint">Or type any emoji</span>
              <input className="input" value={value} maxLength={12} onChange={(e) => onChange(e.target.value.trim())} aria-label="Emoji" />
            </label>
          </div>
        )}
      </Popover>
    </div>
  )
}

function CategoryRow({ category, onSaved, onDeleted }: { category: Category; onSaved: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(category.name)
  const [emoji, setEmoji] = useState(category.emoji)
  const [kind, setKind] = useState<CategoryKind>(category.kind)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = name !== category.name || emoji !== category.emoji || kind !== category.kind
  const builtIn = category.plaid_primary !== null

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.updateCategory(category.id, { name, emoji, kind })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="category-row">
      <EmojiField value={emoji} onChange={setEmoji} label={`Emoji for ${category.name}`} />
      <div className="category-row-main">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label={`Name for ${category.name}`} />
        <span className="muted">
          {category.transaction_count} transaction{category.transaction_count === 1 ? '' : 's'}
          {category.plaid_primary ? ` · Plaid: ${formatCategory(category.plaid_primary)}` : category.plaid_primary === '' ? ' · when Plaid has no category' : ' · yours'}
        </span>
        {error && <span className="field-error">{error}</span>}
      </div>
      <select className="input kind-select" value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)} aria-label={`Type for ${category.name}`}>
        {KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      <div className="category-row-actions">
        {dirty && (
          <button className="button small primary" disabled={busy || !name.trim() || !emoji} onClick={() => void save()}>
            Save
          </button>
        )}
        {!builtIn && !dirty && (
          <button
            className="button small danger"
            disabled={busy}
            onClick={() => {
              const n = category.transaction_count
              if (!window.confirm(`Delete ${category.name}?${n ? ` Its ${n} transaction${n === 1 ? '' : 's'} go back to their automatic category.` : ''}`)) return
              setBusy(true)
              api.deleteCategory(category.id).then(onDeleted, (e: Error) => {
                setError(e.message)
                setBusy(false)
              })
            }}
          >
            Delete
          </button>
        )}
      </div>
    </li>
  )
}

/** Window for renaming categories, changing their emoji and type, and adding or deleting your own. */
export function ManageCategories({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newEmoji, setNewEmoji] = useState('🏷️')
  const [newKind, setNewKind] = useState<CategoryKind>('expense')

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  useEffect(() => {
    let cancelled = false
    api.categories().then(
      (list) => !cancelled && setCategories(list),
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [version])

  const changed = () => {
    setVersion((v) => v + 1)
    onChanged()
  }

  const add = async () => {
    setError(null)
    try {
      await api.createCategory({ name: newName, emoji: newEmoji, kind: newKind })
      setNewName('')
      setNewEmoji('🏷️')
      setNewKind('expense')
      changed()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <dialog
      ref={ref}
      className="dialog wide"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      aria-labelledby="categories-title"
    >
      <div className="dialog-inner">
        <div className="dialog-head">
          <h2 id="categories-title">Categories</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="muted-text">
          <strong>Expense</strong> counts as spending, <strong>Income</strong> as income, and <strong>Transfer</strong> as neither (card payments,
          moving money between your accounts). Categories Plaid uses can be renamed but not deleted.
        </p>
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        <form
          className="category-row new"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <EmojiField value={newEmoji} onChange={setNewEmoji} label="Emoji for the new category" />
          <div className="category-row-main">
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} placeholder="New category name" aria-label="New category name" />
          </div>
          <select className="input kind-select" value={newKind} onChange={(e) => setNewKind(e.target.value as CategoryKind)} aria-label="Type for the new category">
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <div className="category-row-actions">
            <button className="button small primary" type="submit" disabled={!newName.trim() || !newEmoji}>
              Add
            </button>
          </div>
        </form>
        {!categories ? (
          <p className="empty compact">Loading…</p>
        ) : (
          <ul className="category-list">
            {categories.map((c) => (
              <CategoryRow key={`${c.id}:${c.name}:${c.emoji}:${c.kind}`} category={c} onSaved={changed} onDeleted={changed} />
            ))}
          </ul>
        )}
      </div>
    </dialog>
  )
}
