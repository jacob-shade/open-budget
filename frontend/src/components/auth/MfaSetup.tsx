import { useEffect, useState } from 'react'
import { ApiError, api } from '../../api/client'
import type { MfaSetup as MfaSetupData, User } from '../../api/types'
import { CodeInput } from './CodeInput'

interface Props {
  user: User
  onDone: () => void
  onSignOut: () => void
}

export function MfaSetup({ user, onDone, onSignOut }: Props) {
  const [setup, setSetup] = useState<MfaSetupData | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [savedCodes, setSavedCodes] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.mfaSetup().then(setSetup, (e: Error) => setError(e.message))
  }, [])

  const enable = async (code: string) => {
    try {
      const res = await api.mfaEnable(code)
      setError(null)
      setRecoveryCodes(res.recovery_codes)
    } catch (e) {
      const err = e as ApiError
      if (err.status === 429) return onSignOut()
      setError(err.attemptsLeft != null ? `${err.message} ${err.attemptsLeft} attempt(s) left.` : err.message)
    }
  }

  if (recoveryCodes) {
    return (
      <div className="auth-card">
        <h1>Save your recovery codes</h1>
        <p className="muted-text">
          If you lose your phone, each of these codes can be used <strong>once</strong> instead of an authenticator code.
          This is the only time they'll be shown.
        </p>
        <ol className="recovery-codes">
          {recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
        <div className="auth-actions">
          <button className="button" onClick={() => navigator.clipboard?.writeText(recoveryCodes.join('\n'))}>
            Copy
          </button>
          <button
            className="button"
            onClick={() => {
              const blob = new Blob([`Open Budget recovery codes for ${user.email}\n\n${recoveryCodes.join('\n')}\n`], {
                type: 'text/plain',
              })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = 'open-budget-recovery-codes.txt'
              a.click()
              URL.revokeObjectURL(a.href)
            }}
          >
            Download
          </button>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={savedCodes} onChange={(e) => setSavedCodes(e.target.checked)} />
          I've saved these somewhere safe
        </label>
        <button className="button primary" disabled={!savedCodes} onClick={onDone}>
          Continue
        </button>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <h1>Set up two-factor sign-in</h1>
      <p className="muted-text">
        Signed in as {user.email}. Open <strong>Google Authenticator</strong>, tap <strong>+</strong> →{' '}
        <strong>Scan a QR code</strong>, and scan this:
      </p>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {setup && (
        <>
          {/* Rendered as an <img> so the server-generated SVG can't run script. */}
          <img className="qr" src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qr_svg)}`} alt="QR code for your authenticator app" />
          <details className="manual-key">
            <summary>Can't scan? Enter this key instead</summary>
            <code>{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
            <span className="muted">Account: {user.email} · Time-based</span>
          </details>
          <CodeInput label="Enter the 6-digit code the app shows" submitLabel="Verify and turn on" kind="totp" onSubmit={enable} />
        </>
      )}
      <button className="link-button" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  )
}
