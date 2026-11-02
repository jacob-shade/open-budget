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
  category: string | null
  category_detailed: string | null
  pending: boolean
  logo_url: string | null
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
