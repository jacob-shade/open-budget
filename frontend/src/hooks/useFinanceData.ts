import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Account, Item, Transaction } from '../api/types'

/** Loads and mutates the app's data; components only render what this returns. */
export function useFinanceData() {
  const [items, setItems] = useState<Item[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [i, a, t] = await Promise.all([api.items(), api.accounts(), api.transactions({ limit: 200 })])
      setItems(i)
      setAccounts(a)
      setTransactions(t)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const syncAll = useCallback(async () => {
    setSyncing(true)
    try {
      const result = await api.syncAll()
      const added = result.synced.reduce((n, s) => n + s.added, 0)
      setNotice(`Synced ${result.synced.length} connection(s), ${added} new transaction(s).`)
      if (result.failed.length > 0) {
        setError(
          result.failed
            .map((f) =>
              f.plaid_error_code === 'ITEM_LOGIN_REQUIRED'
                ? `${f.institution_name ?? 'A bank'} needs you to log in again (use Reconnect).`
                : `${f.institution_name ?? f.item_id}: ${f.error}`,
            )
            .join(' '),
        )
      } else {
        setError(null)
      }
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }, [refresh])

  const removeItem = useCallback(
    async (id: string) => {
      try {
        await api.removeItem(id)
        await refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [refresh],
  )

  return { items, accounts, transactions, loading, syncing, error, notice, setError, setNotice, refresh, syncAll, removeItem }
}
