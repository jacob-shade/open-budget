import type { BusinessKind, ExpenseCategory } from '../api/types'

export const KIND_LABELS: Record<BusinessKind, string> = {
  collectibles: 'Collectibles reselling',
  general: 'General business',
}

export const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  shipping: 'Shipping & packaging',
  protection: 'Protective supplies',
  table: 'Show & table fees',
  fees: 'Platform & payment fees',
  travel: 'Travel',
  other: 'Other',
}
