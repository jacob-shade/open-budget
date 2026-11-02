import type { Category, Transaction } from '../api/types'
import { formatCategory } from '../format'
import { Popover } from './Popover'

interface Props {
  transaction: Transaction
  categories: Category[]
  /** null = go back to the automatic (Plaid) category. */
  onPick: (categoryId: number | null) => void
  onManage: () => void
}

/** The category shown in a transaction row; click to move the transaction to another category. */
export function CategoryPicker({ transaction: t, categories, onPick, onManage }: Props) {
  const automatic = categories.find((c) => c.plaid_primary === (t.plaid_category ?? '')) ?? categories.find((c) => c.plaid_primary === '')
  return (
    <Popover
      align="left"
      triggerClassName="category-chip"
      ariaLabel={`Category: ${t.category_name}. Change category`}
      label={
        <>
          <span aria-hidden="true">{t.category_emoji}</span>
          <span>{t.category_name}</span>
        </>
      }
    >
      {(close) => (
        <div className="category-menu">
          <ul role="listbox" aria-label="Categories">
            {categories.map((c) => (
              <li key={c.id}>
                <button
                  role="option"
                  aria-selected={c.id === t.category_id}
                  className={`preset${c.id === t.category_id ? ' selected' : ''}`}
                  onClick={() => {
                    close()
                    if (c.id !== t.category_id) onPick(c.id)
                  }}
                >
                  <span className="category-option">
                    <span aria-hidden="true">{c.emoji}</span>
                    {c.name}
                  </span>
                  {c.id === t.category_id && <span aria-hidden="true">✓</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="category-menu-footer">
            {t.category_overridden && automatic && (
              <button
                className="preset"
                onClick={() => {
                  close()
                  onPick(null)
                }}
              >
                <span className="category-option">
                  <span aria-hidden="true">↺</span>
                  Automatic ({automatic.emoji} {automatic.name}
                  {t.plaid_category ? `, from Plaid's ${formatCategory(t.plaid_category).toLowerCase()}` : ''})
                </span>
              </button>
            )}
            <button
              className="preset"
              onClick={() => {
                close()
                onManage()
              }}
            >
              <span className="category-option">
                <span aria-hidden="true">✏️</span>
                Edit categories…
              </span>
            </button>
          </div>
        </div>
      )}
    </Popover>
  )
}
