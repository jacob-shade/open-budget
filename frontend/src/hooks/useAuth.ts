import { useCallback, useEffect, useState } from 'react'
import { SESSION_EXPIRED_EVENT, api } from '../api/client'
import type { AuthState } from '../api/types'

const AUTH_ERRORS: Record<string, string> = {
  not_allowed: "That Google account isn't allowed to use this app.",
  google_cancelled: 'Google sign-in was cancelled.',
  state_mismatch: 'Sign-in expired or was started in another tab. Please try again.',
  state_expired: 'Sign-in took too long. Please try again.',
  google_error: "Couldn't complete sign-in with Google. Please try again.",
  invalid_request: 'Sign-in failed. Please try again.',
  server_error: 'Sign-in failed because of a server error.',
}

/** Reads `?auth_error=` left by the Google callback redirect, then removes it from the URL. */
function takeAuthError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('auth_error')
  if (!code) return null
  params.delete('auth_error')
  const query = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''))
  return AUTH_ERRORS[code] ?? 'Sign-in failed. Please try again.'
}

const ANONYMOUS: AuthState = { status: 'anonymous', user: null }

/** Asks the server who is signed in. Never rejects: a failure means signed out, with the reason. */
function fetchAuth(): Promise<{ auth: AuthState; error: string | null }> {
  return api.me().then(
    (auth) => ({ auth, error: null }),
    (e: Error) => ({ auth: ANONYMOUS, error: e.message }),
  )
}

export function useAuth() {
  // The first check starts while the app first renders, not in an effect; the effect only applies
  // its answer. (In development, StrictMode may start it twice; both are the same harmless GET.)
  const [initial] = useState(fetchAuth)
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [error, setError] = useState<string | null>(takeAuthError)

  const apply = useCallback((r: { auth: AuthState; error: string | null }) => {
    setAuth(r.auth)
    if (r.error) setError(r.error)
  }, [])

  const refresh = useCallback(() => fetchAuth().then(apply), [apply])

  useEffect(() => {
    let live = true
    void initial.then((r) => live && apply(r))
    // A request that comes back "session expired" signs you out here too.
    const onExpired = () => void refresh()
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => {
      live = false
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
    }
  }, [initial, apply, refresh])

  const logout = useCallback(async () => {
    await api.logout().catch(() => {})
    setAuth(ANONYMOUS)
  }, [])

  return { auth, error, setError, refresh, logout }
}
