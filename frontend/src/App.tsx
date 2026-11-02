import { AppShell } from './components/AppShell'
import { MfaSetup } from './components/auth/MfaSetup'
import { MfaVerify } from './components/auth/MfaVerify'
import { SignIn } from './components/auth/SignIn'
import { useAuth } from './hooks/useAuth'

/** Routes between sign-in steps; financial data only loads once fully authenticated. */
export default function App() {
  const { auth, error, refresh, logout } = useAuth()

  if (!auth) return <p className="empty">Loading…</p>

  switch (auth.status) {
    case 'anonymous':
      return <SignIn error={error} />
    case 'mfa_setup':
      return <MfaSetup user={auth.user!} onDone={refresh} onSignOut={logout} />
    case 'mfa_verify':
      return <MfaVerify user={auth.user!} onDone={refresh} onSignOut={logout} />
    case 'authenticated':
      return <AppShell user={auth.user!} onSignOut={logout} />
  }
}
