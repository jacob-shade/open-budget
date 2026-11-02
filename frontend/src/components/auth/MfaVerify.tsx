import { useState } from 'react'
import { ApiError, api } from '../../api/client'
import type { User } from '../../api/types'
import { CodeInput } from './CodeInput'

interface Props {
  user: User
  onDone: () => void
  onSignOut: () => void
}

export function MfaVerify({ user, onDone, onSignOut }: Props) {
  const [useRecovery, setUseRecovery] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const verify = async (value: string) => {
    try {
      await api.mfaVerify(useRecovery ? { recovery_code: value } : { code: value })
      onDone()
    } catch (e) {
      const err = e as ApiError
      if (err.status === 429) return onSignOut()
      setError(err.attemptsLeft != null ? `${err.message} ${err.attemptsLeft} attempt(s) left.` : err.message)
    }
  }

  return (
    <div className="auth-card">
      <h1>Two-factor sign-in</h1>
      <p className="muted-text">Signed in to Google as {user.email}.</p>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {useRecovery ? (
        <CodeInput key="recovery" label="Enter one of your recovery codes" submitLabel="Sign in" kind="recovery" onSubmit={verify} />
      ) : (
        <CodeInput key="totp" label="Enter the 6-digit code from Google Authenticator" submitLabel="Sign in" kind="totp" onSubmit={verify} />
      )}
      <button
        className="link-button"
        onClick={() => {
          setUseRecovery(!useRecovery)
          setError(null)
        }}
      >
        {useRecovery ? 'Use authenticator app instead' : 'Lost your phone? Use a recovery code'}
      </button>
      <button className="link-button" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  )
}
