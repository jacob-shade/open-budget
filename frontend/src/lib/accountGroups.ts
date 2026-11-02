import type { Account } from '../api/types'

export type GroupKey = 'cash' | 'credit' | 'loans' | 'investments' | 'other'

export interface AccountGroup {
  key: GroupKey
  label: string
  liability: boolean
  accounts: Account[]
  /** Sum of balances in cents; for liabilities, the amount owed (positive). */
  totalCents: number
}

const DEFS: { key: GroupKey; label: string; types: string[] | null; liability: boolean }[] = [
  { key: 'cash', label: 'Cash', types: ['depository'], liability: false },
  { key: 'credit', label: 'Credit cards', types: ['credit'], liability: true },
  { key: 'loans', label: 'Loans', types: ['loan'], liability: true },
  { key: 'investments', label: 'Investments', types: ['investment'], liability: false },
  { key: 'other', label: 'Other', types: null, liability: false },
]

const KNOWN = DEFS.flatMap((d) => d.types ?? [])

/** Accounts grouped by Plaid account type, in display order. "Other" catches any remaining type. */
export function groupAccounts(accounts: Account[]): AccountGroup[] {
  return DEFS.map((d) => {
    const list = accounts.filter((a) => (d.types ? d.types.includes(a.type) : !KNOWN.includes(a.type)))
    return {
      key: d.key,
      label: d.label,
      liability: d.liability,
      accounts: list,
      totalCents: list.reduce((s, a) => s + (a.current_balance_cents ?? 0), 0),
    }
  })
}
