export function formatMoney(cents: number | null, currency: string | null = 'USD'): string {
  if (cents === null) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency ?? 'USD' }).format(cents / 100)
}

export function formatDate(isoDate: string): string {
  // Plaid dates are calendar dates (YYYY-MM-DD); parse as local to avoid timezone shift.
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatRelative(isoTimestamp: string | null): string {
  if (!isoTimestamp) return 'never'
  const minutes = Math.round((Date.now() - new Date(isoTimestamp).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / 1440)}d ago`
}

/** "FOOD_AND_DRINK" -> "Food and drink" */
export function formatCategory(category: string | null): string {
  if (!category) return 'Uncategorized'
  const words = category.toLowerCase().replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
