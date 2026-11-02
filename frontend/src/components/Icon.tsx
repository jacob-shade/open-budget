import type { ReactNode } from 'react'

const PATHS = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  accounts: (
    <>
      <path d="M3 10 12 4l9 6" />
      <path d="M5.5 10v8M10 10v8M14 10v8M18.5 10v8" />
      <path d="M3 20h18" />
    </>
  ),
  transactions: (
    <>
      <path d="M4 8h15l-3.5-3.5" />
      <path d="M20 16H5l3.5 3.5" />
    </>
  ),
  cashflow: (
    <>
      <path d="M12 3v18" />
      <path d="M16.5 7.5c-.8-1.3-2.4-2-4.5-2-2.6 0-4.3 1.3-4.3 3.2 0 4.6 9 2.4 9 7 0 1.9-1.9 3.3-4.7 3.3-2.3 0-4-.8-4.8-2.3" />
    </>
  ),
  budget: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9h9" />
    </>
  ),
  goals: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" />
    </>
  ),
  forecasting: (
    <>
      <path d="M3 20h18" />
      <path d="m4 16 5-5 4 3 7-7" />
      <path d="M15 7h5v5" />
    </>
  ),
  business: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M3 13h18" />
    </>
  ),
  // Rounded panel with a divider left of centre: the sidebar toggle.
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
