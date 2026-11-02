// Mirrors the backend view structs in backend/src/views/mod.rs.

export interface Item {
  id: string
  institution_id: string | null
  institution_name: string | null
  last_synced_at: string | null
  created_at: string
}

export interface Account {
  id: string
  item_id: string
  institution_name: string | null
  name: string
  official_name: string | null
  mask: string | null
  type: string
  subtype: string | null
  current_balance_cents: number | null
  available_balance_cents: number | null
  credit_limit_cents: number | null
  currency: string | null
  is_liability: boolean
  /** The business this account belongs to; its money is left out of personal spending. */
  business_id: number | null
  updated_at: string
}

export interface Transaction {
  id: string
  account_id: string
  account_name: string
  /** Negative = money out, positive = money in. */
  amount_cents: number
  currency: string | null
  date: string
  authorized_date: string | null
  name: string
  merchant_name: string | null
  /** Plaid's own primary category, e.g. FOOD_AND_DRINK (what "Automatic" uses). */
  plaid_category: string | null
  category_detailed: string | null
  category_id: number
  category_name: string
  category_emoji: string
  category_kind: CategoryKind
  /** True when you picked the category yourself. */
  category_overridden: boolean
  pending: boolean
  logo_url: string | null
}

export type CategoryKind = 'expense' | 'income' | 'transfer'

export interface Category {
  id: number
  name: string
  emoji: string
  kind: CategoryKind
  /** Plaid category mapped here ('' = uncategorised fallback); null for ones you created. */
  plaid_primary: string | null
  /** Budget bucket; null = not budgeted. Income categories never have one. */
  bucket: Bucket | null
  transaction_count: number
}

export type Bucket = 'fixed' | 'future' | 'fun'

export interface BudgetPercentages {
  fixed_pct: number
  future_pct: number
  fun_pct: number
}

export interface Budget {
  percentages: BudgetPercentages
  income: { label: string; source: 'income' | 'payout'; planned_monthly_cents: number | null; actual_cents: number }[]
  /** Expense and transfer categories with money out in the period. */
  categories: { id: number; name: string; emoji: string; kind: CategoryKind; bucket: Bucket | null; planned_monthly_cents: number | null; actual_cents: number }[]
}

export interface SyncSummary {
  item_id: string
  accounts: number
  added: number
  modified: number
  removed: number
}

export interface SyncFailure {
  item_id: string
  institution_name: string | null
  error: string
  plaid_error_code: string | null
}

export interface SyncAllResult {
  synced: SyncSummary[]
  failed: SyncFailure[]
}

export interface ExchangeResult {
  item: Item
  sync: SyncSummary | null
  sync_error: string | null
}

export interface User {
  email: string
  name: string | null
  picture_url: string | null
}

export type AuthStatus = 'anonymous' | 'mfa_setup' | 'mfa_verify' | 'authenticated'

export interface AuthState {
  status: AuthStatus
  user: User | null
}

export interface MfaSetup {
  secret: string
  otpauth_url: string
  qr_svg: string
}

export interface DailySpending {
  /** YYYY-MM-DD */
  date: string
  spent_cents: number
}


export interface NetWorthPoint {
  /** YYYY-MM-DD */
  date: string
  net_worth_cents: number
}

export type BusinessKind = 'collectibles' | 'general'
export type PaidVia = 'cash' | 'bank'
export type ExpenseCategory = 'shipping' | 'protection' | 'table' | 'fees' | 'travel' | 'other'

export interface Business {
  id: number
  name: string
  kind: BusinessKind
  created_at: string
}

export interface CollectibleItem {
  id: number
  name: string
  category: string | null
  condition: string | null
  acquired_date: string
  acquired_via: 'purchase' | 'trade' | 'other'
  purchase_paid_via: PaidVia | null
  cost_cents: number
  estimated_value_cents: number
  status: 'in_stock' | 'sold' | 'traded'
  sale_id: number | null
  sale_price_cents: number | null
  trade_in_id: number | null
  trade_out_id: number | null
  notes: string | null
}

export interface Sale {
  id: number
  date: string
  total_cents: number
  fees_cents: number
  shipping_cents: number
  channel: string | null
  paid_via: PaidVia
  notes: string | null
  item_names: string | null
  item_count: number
}

export interface Trade {
  id: number
  date: string
  cash_in_cents: number
  cash_out_cents: number
  paid_via: PaidVia
  gain_cents: number
  notes: string | null
  given_names: string | null
  received_names: string | null
}

export interface Expense {
  id: number
  date: string
  category: ExpenseCategory
  amount_cents: number
  paid_via: PaidVia
  description: string | null
}

export interface CashAdjustment {
  id: number
  date: string
  amount_cents: number
  description: string | null
}

export interface BusinessSummary {
  cash_on_hand_cents: number
  bank_cents: number
  inventory_count: number
  inventory_value_cents: number
  inventory_cost_cents: number
  sales_cents: number
  trade_gain_cents: number
  cost_of_sold_cents: number
  selling_costs_cents: number
  expenses_cents: number
  expenses_by_category: { category: ExpenseCategory; amount_cents: number }[]
  profit_cents: number
  /** Paid to you in the period; not an expense, so profit is unchanged. */
  payouts_cents: number
}

export interface Payout {
  id: number
  date: string
  amount_cents: number
  paid_via: PaidVia
  description: string | null
}

export interface NewItem {
  name: string
  category?: string
  condition?: string
  acquired_date: string
  acquired_via: 'purchase' | 'other'
  purchase_paid_via?: PaidVia
  cost_cents: number
  estimated_value_cents: number
  notes?: string
}

export interface NewSale {
  date: string
  item_ids: number[]
  total_cents: number
  fees_cents: number
  shipping_cents: number
  channel?: string
  paid_via: PaidVia
  notes?: string
}

export interface NewTrade {
  date: string
  given_item_ids: number[]
  received: { name: string; category?: string; condition?: string; estimated_value_cents: number }[]
  cash_in_cents: number
  cash_out_cents: number
  paid_via: PaidVia
  notes?: string
}

export interface TransactionSummary {
  count: number
  spending_cents: number
  income_cents: number
  average_expense_cents: number | null
  largest_expense: { id: string; name: string; date: string; amount_cents: number } | null
}

export interface CashFlow {
  /** Largest first. source "payout" = money paid to you from a business. */
  income: { label: string; source: 'income' | 'payout'; business_id: number | null; cents: number }[]
  /** Largest first; Expense categories only. */
  spending: { category_id: number; name: string; emoji: string; cents: number }[]
  total_income_cents: number
  total_spending_cents: number
}
