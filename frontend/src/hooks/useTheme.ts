import { useCallback, useState } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'open-budget:theme'

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** 'system' removes the attribute so the CSS follows prefers-color-scheme. Mirrors the script in index.html. */
function apply(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') delete root.dataset.theme
  else root.dataset.theme = choice
}

/** The theme picked in the profile menu, remembered per browser. */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeChoice>(readChoice)

  const setTheme = useCallback((choice: ThemeChoice) => {
    apply(choice)
    setThemeState(choice)
    try {
      if (choice === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, choice)
    } catch {
      // Storage unavailable (private mode): the choice still applies until reload.
    }
  }, [])

  return { theme, setTheme }
}
