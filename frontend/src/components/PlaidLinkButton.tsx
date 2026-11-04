import { useCallback, useEffect, useState } from 'react'
import { usePlaidLink, type PlaidLinkOnSuccess } from 'react-plaid-link'
import { api } from '../api/client'

// OAuth banks redirect the browser away and back to /oauth; Link must be re-opened
// there with the same token, so we keep it in localStorage for that round trip.
const TOKEN_KEY = 'plaid_link_token'
const isOAuthRedirect = window.location.pathname === '/oauth'

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable: OAuth redirect resume won't work, normal Link still does */
  }
}

interface Props {
  /** Set to re-authenticate an existing connection (Plaid "update mode"). */
  itemId?: string
  label?: string
  className?: string
  onLinked: (message: string) => void
  onError: (message: string) => void
}

export function PlaidLinkButton({ itemId, label = 'Connect a bank', className = 'button primary', onLinked, onError }: Props) {
  const [token, setToken] = useState<string | null>(() => (isOAuthRedirect && !itemId ? readStoredToken() : null))
  const [busy, setBusy] = useState(false)

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    async (publicToken, metadata) => {
      storeToken(null)
      setToken(null)
      if (isOAuthRedirect) window.history.replaceState(null, '', '/')
      if (itemId) {
        // Update mode: the existing access token is valid again, no exchange needed.
        onLinked(`${metadata.institution?.name ?? 'Connection'} reconnected.`)
        return
      }
      if (!publicToken) {
        onError('Plaid Link did not return a public token.')
        return
      }
      setBusy(true)
      try {
        const institution = metadata.institution ? { id: metadata.institution.institution_id, name: metadata.institution.name } : null
        const result = await api.exchangePublicToken(publicToken, institution)
        onLinked(
          result.sync
            ? `Connected ${institution?.name ?? 'bank'}: ${result.sync.accounts} account(s), ${result.sync.added} transaction(s).`
            : `Connected ${institution?.name ?? 'bank'}. Transactions aren't ready yet; try Sync in a minute.`,
        )
      } catch (e) {
        onError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [itemId, onLinked, onError],
  )

  const { open, ready } = usePlaidLink({
    token,
    onSuccess,
    // Errors inside Plaid's window never reach the server on their own; log their codes so they can be diagnosed.
    onEvent: (eventName, m) => {
      if (eventName !== 'ERROR') return
      void api.reportLinkEvent({
        event: eventName,
        error_code: m.error_code,
        error_type: m.error_type,
        error_message: m.error_message,
        institution_id: m.institution_id,
        institution_name: m.institution_name,
        link_session_id: m.link_session_id,
        request_id: m.request_id,
      })
    },
    onExit: (err, m) => {
      storeToken(null)
      setToken(null)
      if (!err) return
      void api.reportLinkEvent({
        event: 'EXIT',
        error_code: err.error_code,
        error_type: err.error_type,
        error_message: err.error_message,
        institution_id: m.institution?.institution_id,
        institution_name: m.institution?.name,
        link_session_id: m.link_session_id,
        request_id: m.request_id,
        status: m.status,
      })
      const where = m.institution?.name ? `${m.institution.name}: ` : ''
      onError(`${where}${err.display_message || err.error_message} (Plaid error ${err.error_code})`)
    },
    ...(isOAuthRedirect && !itemId ? { receivedRedirectUri: window.location.href } : {}),
  })

  // Open Link as soon as it's ready with a fresh token.
  useEffect(() => {
    if (token && ready) open()
  }, [token, ready, open])

  const start = async () => {
    setBusy(true)
    try {
      const { link_token } = await api.createLinkToken(itemId)
      storeToken(link_token)
      setToken(link_token)
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className={className} onClick={start} disabled={busy || (token !== null && !ready)}>
      {busy ? 'Working…' : label}
    </button>
  )
}
