import type { Account } from '../api/types'

/** Balance with liabilities (credit cards, loans) counted as negative. */
export function signedBalance(a: Account): number {
  const balance = a.current_balance_cents ?? 0
  return a.is_liability ? -balance : balance
}

/** Totals in cents; `liabilities` is negative. */
export function summarize(accounts: Account[]) {
  const assets = accounts.filter((a) => !a.is_liability).reduce((s, a) => s + signedBalance(a), 0)
  const liabilities = accounts.filter((a) => a.is_liability).reduce((s, a) => s + signedBalance(a), 0)
  return { assets, liabilities, netWorth: assets + liabilities }
}
