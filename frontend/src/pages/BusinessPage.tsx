import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Business } from '../api/types'
import type { FinanceData } from '../hooks/useFinanceData'
import { BusinessDetail } from '../components/business/BusinessDetail'
import { BusinessDialog } from '../components/business/forms'
import { Icon } from '../components/Icon'
import { Link } from '../components/Link'
import { navigate } from '../router'

/** /business lists businesses; /business/:id shows one. */
export function BusinessPage({ data, path }: { data: FinanceData; path: string }) {
  const [businesses, setBusinesses] = useState<Business[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedId = Number(path.split('/')[2]) || null

  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let cancelled = false
    api.businesses().then(
      (list) => !cancelled && setBusinesses(list),
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [version])

  // /business with businesses → open the first one.
  useEffect(() => {
    if (businesses?.length && (!selectedId || !businesses.some((b) => b.id === selectedId))) {
      navigate(`/business/${businesses[0].id}`, { replace: true })
    }
  }, [businesses, selectedId])

  const selected = businesses?.find((b) => b.id === selectedId) ?? null

  return (
    <main className="business-page">
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {businesses === null ? (
        <p className="empty">Loading…</p>
      ) : businesses.length === 0 ? (
        <section className="panel planned">
          <span className="planned-icon">
            <Icon name="business" size={28} />
          </span>
          <h2>Track a business</h2>
          <p className="muted-text">
            Add a business to track its inventory, sales, trades, expenses and cash, kept separate from your personal finances.
          </p>
          <button className="button primary" onClick={() => setAdding(true)}>
            Add business
          </button>
        </section>
      ) : (
        <>
          <nav className="business-switcher" aria-label="Businesses">
            {businesses.map((b) => (
              <Link key={b.id} href={`/business/${b.id}`} className={`business-pill${b.id === selectedId ? ' active' : ''}`} aria-current={b.id === selectedId ? 'page' : undefined}>
                {b.name}
              </Link>
            ))}
            <button className="button small" onClick={() => setAdding(true)}>
              + Add business
            </button>
          </nav>
          {selected && (
            <BusinessDetail
              key={selected.id}
              business={selected}
              businesses={businesses}
              accounts={data.accounts}
              onAccountsChanged={data.refresh}
              onRenamed={(b) => setBusinesses(businesses.map((x) => (x.id === b.id ? b : x)))}
              onDeleted={() => {
                reload()
                void data.refresh()
                navigate('/business', { replace: true })
              }}
            />
          )}
        </>
      )}
      {adding && (
        <BusinessDialog
          onClose={() => setAdding(false)}
          onSaved={(b) => {
            setBusinesses([...(businesses ?? []), b])
            navigate(`/business/${b.id}`)
          }}
        />
      )}
    </main>
  )
}
