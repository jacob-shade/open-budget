import { useRef, useState, type FormEvent } from 'react'

interface Props {
  label: string
  submitLabel: string
  /** 'totp' = 6 digits, submitted automatically once complete; 'recovery' = free text like K7Q2M-XP9RD. */
  kind: 'totp' | 'recovery'
  onSubmit: (value: string) => Promise<void>
}

export function CodeInput({ label, submitLabel, kind, onSubmit }: Props) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  // Guards against a second submit (e.g. Enter pressed right after the auto-submit) before state updates.
  const inFlight = useRef(false)

  const run = async (code: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      await onSubmit(code)
    } finally {
      inFlight.current = false
      setBusy(false)
      setValue('')
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(value)
  }

  const onChange = (raw: string) => {
    if (kind !== 'totp') return setValue(raw)
    const digits = raw.replace(/\D/g, '').slice(0, 6)
    setValue(digits)
    // Typing or pasting the 6th digit checks the code right away.
    if (digits.length === 6) void run(digits)
  }

  const ready = kind === 'totp' ? /^\d{6}$/.test(value) : value.trim().length >= 10

  return (
    <form className="code-form" onSubmit={submit}>
      <label htmlFor={`code-${kind}`}>{label}</label>
      <input
        id={`code-${kind}`}
        className={`code-input ${kind}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // readOnly rather than disabled, so the field keeps focus for the next attempt.
        readOnly={busy}
        inputMode={kind === 'totp' ? 'numeric' : 'text'}
        autoComplete="one-time-code"
        placeholder={kind === 'totp' ? '123456' : 'XXXXX-XXXXX'}
        autoFocus
      />
      <button className="button primary" type="submit" disabled={!ready || busy}>
        {busy ? 'Checking…' : submitLabel}
      </button>
    </form>
  )
}
