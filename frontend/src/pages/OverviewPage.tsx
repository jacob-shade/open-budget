import type { FinanceData } from '../hooks/useFinanceData'
import { formatMoney } from '../format'
import { BusinessProfit } from '../components/BusinessProfit'
import { Link } from '../components/Link'
import { NetWorth } from '../components/NetWorth'
import { SpendingChart } from '../components/SpendingChart'

/** Default page. A shared grid (see .overview-grid) so Accounts ends level with Investments and Goals. */
export function OverviewPage({ data }: { data: FinanceData }) {
  const investments = data.accounts.filter((a) => a.type === 'investment')
  const investedCents = investments.reduce((s, a) => s + (a.current_balance_cents ?? 0), 0)

  return (
    <main className="overview-grid">
      <section className="panel area-networth">
        <NetWorth accounts={data.accounts} />
      </section>
      <section className="panel area-accounts">
        <div className="panel-header">
          <h2>Accounts</h2>
          <Link className="button small" href="/accounts">
            Manage
          </Link>
        </div>
        {data.accounts.length === 0 ? (
          <p className="empty">No banks connected yet. Use Connect a bank to add one.</p>
        ) : (
          <ul className="account-summary">
            {data.accounts.map((a) => (
              <li key={a.id}>
                <span>
                  <span className="account-name">{a.name}</span>
                  <span className="muted">
                    {a.institution_name ?? a.subtype ?? a.type}
                    {a.mask ? ` ••${a.mask}` : ''}
                  </span>
                </span>
                <span className={a.is_liability ? 'negative' : ''}>{formatMoney(a.current_balance_cents, a.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SpendingChart refreshKey={data.transactions} />
      <div className="overview-pair area-pair">
        <section className="panel">
          <div className="panel-header">
            <h2>Investments</h2>
          </div>
          {investments.length === 0 ? (
            <p className="empty compact">No investment accounts connected.</p>
          ) : (
            <>
              <div className="box-total">
                <span className="value">{formatMoney(investedCents)}</span>
                <span className="muted">
                  across {investments.length} account{investments.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="account-summary">
                {investments.map((a) => (
                  <li key={a.id}>
                    <span>
                      <span className="account-name">{a.name}</span>
                      <span className="muted">{a.subtype ?? a.institution_name}</span>
                    </span>
                    <span>{formatMoney(a.current_balance_cents, a.currency)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>Goals</h2>
            <Link className="button small" href="/goals">
              Open
            </Link>
          </div>
          <p className="empty compact">No goals yet. Setting goals isn't built yet.</p>
        </section>
      </div>
      <BusinessProfit onError={data.setError} refreshKey={data.transactions} />
    </main>
  )
}
