/** Parses what someone typed as dollars ("$1,234.5", "12", ".99") into cents. Null if not a number. */
export function parseCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '')
  if (cleaned === '') return 0
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === '.' || cleaned === '-') return null
  return Math.round(Number(cleaned) * 100)
}

/** Cents as a plain dollar string for an input field ("1234.50"). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Today's date in local time, YYYY-MM-DD. */
export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export type Period = 'this-month' | 'last-month' | 'year-to-date' | 'all-time'

export const PERIODS: { value: Period; label: string }[] = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'year-to-date', label: 'Year to date' },
  { value: 'all-time', label: 'All time' },
]

/** Inclusive date range (YYYY-MM-DD) for a period, relative to `today`. */
export function periodRange(period: Period, today = new Date()): { start: string; end: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const y = today.getFullYear()
  const m = today.getMonth()
  switch (period) {
    case 'last-month':
      return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) }
    case 'year-to-date':
      return { start: iso(new Date(y, 0, 1)), end: iso(today) }
    case 'all-time':
      return { start: '1900-01-01', end: iso(today) }
    default:
      return { start: iso(new Date(y, m, 1)), end: iso(today) }
  }
}
