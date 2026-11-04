import { Icon } from './Icon'

interface Props {
  shown: boolean
  onToggle: () => void
  /** What the button shows or hides, e.g. "net worth", "account balances". */
  what: string
}

/** Eye button that shows or hides the amounts in one box. */
export function NetWorthToggle({ shown, onToggle, what }: Props) {
  const label = `${shown ? 'Hide' : 'Show'} ${what}`
  return (
    <button type="button" className="eye-button" onClick={onToggle} aria-pressed={shown} aria-label={label} title={label}>
      <Icon name={shown ? 'eyeOff' : 'eye'} size={16} />
    </button>
  )
}
