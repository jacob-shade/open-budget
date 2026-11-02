import type { Account, ExchangeResult, Item, SyncAllResult, SyncSummary, Transaction } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly plaidErrorCode: string | null

  constructor(message: string, status: number, plaidErrorCode: string | null) {
    super(message)
    this.status = status
    this.plaidErrorCode = plaidErrorCode
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new ApiError(data.error ?? `${method} ${path} failed (${res.status})`, res.status, data.plaid_error_code ?? null)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export const api = {
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
  transactions: (params: { accountId?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.accountId) q.set('account_id', params.accountId)
    if (params.limit) q.set('limit', String(params.limit))
    if (params.offset) q.set('offset', String(params.offset))
    return request<Transaction[]>('GET', `/transactions?${q}`)
  },
}
