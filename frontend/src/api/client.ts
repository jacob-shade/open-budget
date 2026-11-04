import type {
  Account,
  AuthState,
  Bucket,
  Budget,
  BudgetPercentages,
  Business,
  BusinessKind,
  BusinessSummary,
  CashAdjustment,
  CashFlow,
  Category,
  CategoryKind,
  CollectibleItem,
  DailySpending,
  ExchangeResult,
  Expense,
  ExpenseCategory,
  Item,
  ManualAccountInput,
  MfaSetup,
  NetWorthPoint,
  NewItem,
  NewSale,
  NewTrade,
  PaidVia,
  Payout,
  Sale,
  SyncAllResult,
  SyncSummary,
  Trade,
  Transaction,
  TransactionSummary,
} from './types'

export class ApiError extends Error {
  readonly status: number
  readonly plaidErrorCode: string | null
  readonly attemptsLeft: number | null

  constructor(message: string, status: number, plaidErrorCode: string | null, attemptsLeft: number | null = null) {
    super(message)
    this.status = status
    this.plaidErrorCode = plaidErrorCode
    this.attemptsLeft = attemptsLeft
  }
}

/** Fired when a data request comes back 401 (session expired or signed out elsewhere). */
export const SESSION_EXPIRED_EVENT = 'open-budget:session-expired'

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    throw new ApiError(
      data.error ?? `${method} ${path} failed (${res.status})`,
      res.status,
      data.plaid_error_code ?? null,
      data.attempts_left ?? null,
    )
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export interface TransactionQuery {
  accountId?: string
  accounts?: string[]
  /** YYYY-MM-DD, inclusive. */
  start?: string
  end?: string
  search?: string
  /** Category ids. */
  categories?: number[]
  direction?: 'all' | 'in' | 'out'
  limit?: number
  offset?: number
}

function transactionParams(params: TransactionQuery): URLSearchParams {
  const q = new URLSearchParams()
  if (params.accountId) q.set('account_id', params.accountId)
  if (params.accounts?.length) q.set('accounts', params.accounts.join(','))
  if (params.start) q.set('start', params.start)
  if (params.end) q.set('end', params.end)
  if (params.search?.trim()) q.set('q', params.search.trim())
  if (params.categories?.length) q.set('categories', params.categories.join(','))
  if (params.direction && params.direction !== 'all') q.set('direction', params.direction)
  if (params.limit) q.set('limit', String(params.limit))
  if (params.offset) q.set('offset', String(params.offset))
  return q
}

export const api = {
  // Sign-in. Google login itself is a full-page redirect to /api/auth/google/login.
  me: () => request<AuthState>('GET', '/auth/me'),
  mfaSetup: () => request<MfaSetup>('POST', '/auth/mfa/setup'),
  mfaEnable: (code: string) => request<{ recovery_codes: string[] }>('POST', '/auth/mfa/enable', { code }),
  mfaVerify: (input: { code: string } | { recovery_code: string }) => request<void>('POST', '/auth/mfa/verify', input),
  logout: () => request<void>('POST', '/auth/logout'),

  createLinkToken: (itemId?: string) =>
    request<{ link_token: string; expiration: string }>('POST', '/plaid/link-token', itemId ? { item_id: itemId } : {}),
  exchangePublicToken: (publicToken: string, institution?: { id: string | null; name: string | null } | null) =>
    request<ExchangeResult>('POST', '/plaid/exchange', {
      public_token: publicToken,
      institution_id: institution?.id ?? undefined,
      institution_name: institution?.name ?? undefined,
    }),
  items: () => request<Item[]>('GET', '/items'),
  removeItem: (id: string) => request<void>('DELETE', `/items/${encodeURIComponent(id)}`),
  syncItem: (id: string) => request<SyncSummary>('POST', `/items/${encodeURIComponent(id)}/sync`),
  syncAll: () => request<SyncAllResult>('POST', '/sync'),
  accounts: () => request<Account[]>('GET', '/accounts'),
  transactions: (params: TransactionQuery = {}) => request<Transaction[]>('GET', `/transactions?${transactionParams(params)}`),
  /** Put a transaction in a category; null goes back to the automatic one. */
  setTransactionCategory: (id: string, categoryId: number | null) =>
    request<void>('PATCH', `/transactions/${encodeURIComponent(id)}`, { category_id: categoryId }),
  /** Sends Plaid Link error details (codes and ids only) to the server log for diagnosis. */
  reportLinkEvent: (e: Record<string, string | null | undefined>) => request<void>('POST', '/plaid/link-event', e).catch(() => {}),
  categories: () => request<Category[]>('GET', '/categories'),
  createCategory: (c: { name: string; emoji: string; kind: CategoryKind; bucket?: Bucket | 'none' }) => request<Category>('POST', '/categories', c),
  updateCategory: (id: number, c: Partial<{ name: string; emoji: string; kind: CategoryKind; bucket: Bucket | 'none' }>) =>
    request<Category>('PATCH', `/categories/${id}`, c),
  /** Category ids in their new order (one list); other categories keep their places. */
  reorderCategories: (ids: number[]) => request<void>('PUT', '/categories/order', { ids }),
  deleteCategory: (id: number) => request<void>('DELETE', `/categories/${id}`),
  /** Totals over every transaction matching the filters (limit/offset ignored). */
  transactionSummary: (params: TransactionQuery = {}) =>
    request<TransactionSummary>('GET', `/transactions/summary?${transactionParams(params)}`),

  /** Spending per day, start..end inclusive (YYYY-MM-DD); transfers and payments excluded. */
  dailySpending: (start: string, end: string) =>
    request<DailySpending[]>('GET', `/spending/daily?${new URLSearchParams({ start, end })}`),
  /** Estimated daily net worth up to `end`; `start` omitted = from the earliest transaction. */
  netWorthHistory: (start: string | null, end: string) =>
    request<NetWorthPoint[]>('GET', `/net-worth/history?${new URLSearchParams(start ? { start, end } : { end })}`),
  /** Interest rate in basis points (3.50% = 350); null clears it. */
  setAccountApy: (id: string, apyBps: number | null) => request<void>('PUT', `/accounts/${encodeURIComponent(id)}/apy`, { apy_bps: apyBps }),
  /** Rename a linked account; null or empty goes back to the bank's name. */
  renameAccount: (id: string, nickname: string | null) => request<void>('PUT', `/accounts/${encodeURIComponent(id)}/name`, { nickname }),
  createManualAccount: (a: ManualAccountInput) => request<{ id: string }>('POST', '/manual-accounts', a),
  updateManualAccount: (id: string, a: ManualAccountInput) => request<void>('PATCH', `/manual-accounts/${encodeURIComponent(id)}`, a),
  deleteManualAccount: (id: string) => request<void>('DELETE', `/manual-accounts/${encodeURIComponent(id)}`),
  /** Link an account to a business, or null to make it personal. */
  setAccountBusiness: (id: string, businessId: number | null) =>
    request<void>('PATCH', `/accounts/${encodeURIComponent(id)}`, { business_id: businessId }),

  // Businesses
  businesses: () => request<Business[]>('GET', '/businesses'),
  createBusiness: (name: string, kind: BusinessKind) => request<Business>('POST', '/businesses', { name, kind }),
  renameBusiness: (id: number, name: string) => request<Business>('PATCH', `/businesses/${id}`, { name }),
  deleteBusiness: (id: number) => request<void>('DELETE', `/businesses/${id}`),
  businessSummary: (id: number, start: string, end: string) =>
    request<BusinessSummary>('GET', `/businesses/${id}/summary?${new URLSearchParams({ start, end })}`),
  /** All businesses combined. */
  allBusinessSummary: (start: string, end: string) =>
    request<BusinessSummary>('GET', `/business-summary?${new URLSearchParams({ start, end })}`),
  businessItems: (id: number) => request<CollectibleItem[]>('GET', `/businesses/${id}/items`),
  createItem: (id: number, item: NewItem) => request<CollectibleItem>('POST', `/businesses/${id}/items`, item),
  updateItem: (id: number, itemId: number, changes: Partial<Pick<CollectibleItem, 'name' | 'category' | 'condition' | 'estimated_value_cents' | 'cost_cents' | 'notes'>>) =>
    request<CollectibleItem>('PATCH', `/businesses/${id}/items/${itemId}`, changes),
  deleteItem: (id: number, itemId: number) => request<void>('DELETE', `/businesses/${id}/items/${itemId}`),
  sales: (id: number) => request<Sale[]>('GET', `/businesses/${id}/sales`),
  createSale: (id: number, sale: NewSale) => request<{ id: number }>('POST', `/businesses/${id}/sales`, sale),
  deleteSale: (id: number, saleId: number) => request<void>('DELETE', `/businesses/${id}/sales/${saleId}`),
  trades: (id: number) => request<Trade[]>('GET', `/businesses/${id}/trades`),
  createTrade: (id: number, trade: NewTrade) => request<{ id: number }>('POST', `/businesses/${id}/trades`, trade),
  deleteTrade: (id: number, tradeId: number) => request<void>('DELETE', `/businesses/${id}/trades/${tradeId}`),
  expenses: (id: number) => request<Expense[]>('GET', `/businesses/${id}/expenses`),
  createExpense: (id: number, e: { date: string; category: ExpenseCategory; amount_cents: number; paid_via: PaidVia; description?: string }) =>
    request<{ id: number }>('POST', `/businesses/${id}/expenses`, e),
  deleteExpense: (id: number, rowId: number) => request<void>('DELETE', `/businesses/${id}/expenses/${rowId}`),
  cash: (id: number) => request<CashAdjustment[]>('GET', `/businesses/${id}/cash`),
  createCash: (id: number, c: { date: string; amount_cents: number; description?: string }) =>
    request<{ id: number }>('POST', `/businesses/${id}/cash`, c),
  deleteCash: (id: number, rowId: number) => request<void>('DELETE', `/businesses/${id}/cash/${rowId}`),
  payouts: (id: number) => request<Payout[]>('GET', `/businesses/${id}/payouts`),
  createPayout: (id: number, p: { date: string; amount_cents: number; paid_via: PaidVia; description?: string }) =>
    request<{ id: number }>('POST', `/businesses/${id}/payouts`, p),
  deletePayout: (id: number, rowId: number) => request<void>('DELETE', `/businesses/${id}/payouts/${rowId}`),
  budget: (start: string, end: string) => request<Budget>('GET', `/budget?${new URLSearchParams({ start, end })}`),
  setBudgetPercentages: (p: BudgetPercentages) => request<BudgetPercentages>('PUT', '/budget/percentages', p),
  /** Planned spending per month for a category; null removes the plan. */
  setCategoryPlan: (categoryId: number, monthlyCents: number | null) =>
    request<void>('PUT', '/budget/category-plans', { category_id: categoryId, monthly_cents: monthlyCents }),
  /** Planned income per month for a source; null removes the plan. */
  setIncomePlan: (source: 'income' | 'payout', label: string, monthlyCents: number | null) =>
    request<void>('PUT', '/budget/income-plans', { source, label, monthly_cents: monthlyCents }),
  /** Personal income streams (incl. business payouts) and spending by category, start..end inclusive. */
  cashFlow: (start: string, end: string) => request<CashFlow>('GET', `/cash-flow?${new URLSearchParams({ start, end })}`),
}
