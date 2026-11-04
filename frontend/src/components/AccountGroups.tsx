import type { Account } from '../api/types'
import type { AccountGroup } from '../lib/accountGroups'
import { formatMoney, formatRelative } from '../format'

interface Lender {
  key: string
  name: string
  accounts: Account[]
  totalCents: number
  /** Sum of minimum monthly payments, if any account has one. */
  minPaymentCents: number | null
}

/** Accounts grouped by institution (ignoring case and spacing), in the order they first appear. */
function byInstitution(accounts: Account[]): Lender[] {
  const lenders = new Map<string, Lender>()
  for (const a of accounts) {
    const name = a.institution_name?.trim() || 'Unknown institution'
    const key = name.toLowerCase().replace(/\s+/g, ' ')
    const l = lenders.get(key) ?? { key, name, accounts: [], totalCents: 0, minPaymentCents: null }
    l.accounts.push(a)
    l.totalCents += a.current_balance_cents ?? 0
    if (a.min_payment_cents != null) l.minPaymentCents = (l.minPaymentCents ?? 0) + a.min_payment_cents
    lenders.set(key, l)
  }
  return [...lenders.values()]
}

interface Props {
  groups: AccountGroup[]
  onEditManual: (a: Account) => void
  onDeleteManual: (a: Account) => void
  onSetApy: (a: Account) => void
  onRename: (a: Account) => void
}

/**
 * Collapsible sections per account type, all open by default. Within a section, an institution with
 * two or more accounts gets a heading with its total. "Other" only appears if used.
 */
export function AccountGroups({ groups, onEditManual, onDeleteManual, onSetApy, onRename }: Props) {
  const row = (a: Account, g: AccountGroup, grouped: boolean) => (
    <li key={a.id}>
      <span>
        <span className="account-name">
          {a.name}
          {a.business_id != null && <span className="tag">Business</span>}
          {a.is_manual && <span className="tag">Manual</span>}
        </span>
        <span className="muted">
          {/* Under an institution heading, the name is already shown. */}
          {grouped ? '' : (a.institution_name ?? 'Unknown institution')}
          {a.mask ? `${grouped ? '' : ' '}••${a.mask}` : ''}
          {a.subtype ? `${grouped && !a.mask ? '' : ' · '}${a.subtype}` : ''}
          {a.is_manual ? ` · updated ${formatRelative(a.updated_at)}` : ''}
          {a.apy_bps != null ? ` · ${(a.apy_bps / 100).toFixed(2)}% ${g.liability ? 'APR' : 'APY'}` : ''}
          {a.min_payment_cents != null ? ` · min ${formatMoney(a.min_payment_cents)}/mo` : ''}
        </span>
      </span>
      <span className="account-balance">
        <span className={g.liability ? 'negative' : ''}>{formatMoney(a.current_balance_cents, a.currency)}</span>
        <span className="manual-actions">
          {!a.is_manual && (
            <button className="button small" onClick={() => onRename(a)}>
              Rename
            </button>
          )}
          {(g.key === 'cash' || g.key === 'investments') && (
            <button className="button small" onClick={() => onSetApy(a)}>
              {a.apy_bps != null ? 'APY' : 'Set APY'}
            </button>
          )}
          {a.is_manual && (
            <>
              <button className="button small" onClick={() => onEditManual(a)}>
                Update
              </button>
              <button
                className="button small danger"
                onClick={() => {
                  if (window.confirm(`Delete ${a.name}? It's only removed from Open Budget.`)) onDeleteManual(a)
                }}
              >
                Delete
              </button>
            </>
          )}
        </span>
      </span>
    </li>
  )

  return (
    <div className="account-groups">
      {groups
        .filter((g) => g.key !== 'other' || g.accounts.length > 0)
        .map((g) => (
          <details key={g.key} className="panel account-group" open>
            <summary>
              <span className="group-title">
                <svg className="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 6 6 6-6 6" />
                </svg>
                <h2>{g.label}</h2>
                <span className="muted">{g.accounts.length}</span>
              </span>
              <span className={`group-total${g.liability && g.totalCents > 0 ? ' negative' : ''}`}>{formatMoney(g.totalCents)}</span>
            </summary>
            {g.accounts.length === 0 ? (
              <p className="empty compact">None connected.</p>
            ) : (
              <ul className="account-summary">
                {byInstitution(g.accounts).map((l) =>
                  l.accounts.length < 2 ? (
                    row(l.accounts[0], g, false)
                  ) : (
                    <li key={`inst:${l.key}`} className="institution-group">
                      <div className="institution-head">
                        <span>
                          <span className="account-name">{l.name}</span>
                          <span className="muted">
                            {l.accounts.length} accounts
                            {l.minPaymentCents != null && ` · min ${formatMoney(l.minPaymentCents)}/mo`}
                          </span>
                        </span>
                        <span className={`institution-total${g.liability && l.totalCents > 0 ? ' negative' : ''}`}>{formatMoney(l.totalCents)}</span>
                      </div>
                      <ul className="account-summary nested">{l.accounts.map((a) => row(a, g, true))}</ul>
                    </li>
                  ),
                )}
              </ul>
            )}
          </details>
        ))}
    </div>
  )
}
