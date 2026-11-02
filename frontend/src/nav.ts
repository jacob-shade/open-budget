import type { IconName } from './components/Icon'

export interface NavItem {
  path: string
  label: string
  icon: IconName
  /** Set for sections that aren't built yet: shown on their placeholder page. */
  planned?: string
}

/** Sidebar order. Overview ("/") is the default page. */
export const NAV: NavItem[] = [
  { path: '/', label: 'Overview', icon: 'overview' },
  { path: '/accounts', label: 'Accounts', icon: 'accounts' },
  { path: '/transactions', label: 'Transactions', icon: 'transactions' },
  { path: '/cash-flow', label: 'Cash flow', icon: 'cashflow', planned: 'Money coming in versus going out, month by month.' },
  { path: '/budget', label: 'Budget', icon: 'budget', planned: 'Monthly spending limits by category, and how you are tracking against them.' },
  { path: '/goals', label: 'Goals', icon: 'goals', planned: 'Savings targets and your progress toward each one.' },
  { path: '/forecasting', label: 'Forecasting', icon: 'forecasting', planned: 'Projected balances based on your income and spending history.' },
  { path: '/business', label: 'Business', icon: 'business' },
]
