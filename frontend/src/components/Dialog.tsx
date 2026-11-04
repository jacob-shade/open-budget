import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useBackdropClose } from '../lib/useBackdropClose'

interface Props {
  title: string
  /** Submit button label. */
  submitLabel: string
  onClose: () => void
  /** Throw to show the error inside the dialog; resolve to close it. */
  onSubmit: () => Promise<void>
  children: ReactNode
  wide?: boolean
  /** Disables submit (e.g. while the form is incomplete). */
  canSubmit?: boolean
  /** Shown at the left of the buttons, e.g. a Delete button. */
  extraAction?: ReactNode
}

/** Modal form built on <dialog>: focus is trapped, Escape and the backdrop close it. */
export function Dialog({ title, submitLabel, onClose, onSubmit, children, wide, canSubmit = true, extraAction }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(ref, onClose)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' wide' : ''}`}
      onClose={onClose}
      {...backdrop}
      aria-labelledby="dialog-title"
    >
      <form onSubmit={submit}>
        <h2 id="dialog-title">{title}</h2>
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          {extraAction && <div className="dialog-extra">{extraAction}</div>}
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy || !canSubmit}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}

/** A labelled form field. */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}
