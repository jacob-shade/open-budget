import type { Account, AuthState, ExchangeResult, Item, MfaSetup, SyncAllResult, SyncSummary, Transaction } from './types'

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
  transactions: (params: { accountId?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.accountId) q.set('account_id', params.accountId)
    if (params.limit) q.set('limit', String(params.limit))
    if (params.offset) q.set('offset', String(params.offset))
    return request<Transaction[]>('GET', `/transactions?${q}`)
  },
}
