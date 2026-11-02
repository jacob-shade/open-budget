import { useSyncExternalStore } from 'react'

// Minimal client-side routing on top of the History API. The backend serves index.html for
// unknown paths, so every route can also be opened directly or reloaded.

const NAVIGATE_EVENT = 'open-budget:navigate'

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAVIGATE_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAVIGATE_EVENT, onChange)
  }
}

/** The current path, e.g. "/budget"; re-renders on navigation and back/forward. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}

export function navigate(path: string, { replace = false } = {}) {
  if (path === window.location.pathname) return
  if (replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
  window.scrollTo(0, 0)
}
