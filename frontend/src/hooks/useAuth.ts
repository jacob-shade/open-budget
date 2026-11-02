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

export function useAuth() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [error, setError] = useState<string | null>(takeAuthError)

  const refresh = useCallback(async () => {
    try {
      setAuth(await api.me())
    } catch (e) {
      setError((e as Error).message)
      setAuth({ status: 'anonymous', user: null })
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onExpired = () => void refresh()
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [refresh])

  const logout = useCallback(async () => {
    await api.logout().catch(() => {})
    setAuth({ status: 'anonymous', user: null })
  }, [])

  return { auth, error, setError, refresh, logout }
}
