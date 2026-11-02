import type { AccountGroup } from '../lib/accountGroups'
import { formatMoney } from '../format'

/** Collapsible sections per account type, all open by default. "Other" only appears if used. */
export function AccountGroups({ groups }: { groups: AccountGroup[] }) {
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
                {g.accounts.map((a) => (
                  <li key={a.id}>
                    <span>
                      <span className="account-name">
                        {a.name}
                        {a.business_id != null && <span className="tag">Business</span>}
                      </span>
                      <span className="muted">
                        {a.institution_name ?? 'Unknown institution'}
                        {a.mask ? ` ••${a.mask}` : ''}
                        {a.subtype ? ` · ${a.subtype}` : ''}
                      </span>
                    </span>
                    <span className={g.liability ? 'negative' : ''}>{formatMoney(a.current_balance_cents, a.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        ))}
    </div>
  )
}
