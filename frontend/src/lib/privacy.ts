import { useCallback, useEffect, useState } from 'react'

/** What a hidden amount shows instead. */
export const HIDDEN_AMOUNT = '******'

const STORAGE_KEY = 'open-budget:amounts'
const CHANGE_EVENT = 'open-budget:amounts-default'

export type AmountsDefault = 'hidden' | 'shown'

/** Whether sensitive amounts start hidden or shown, set in the profile menu and remembered per browser. */
export function readAmountsDefault(): AmountsDefault {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'shown' ? 'shown' : 'hidden'
  } catch {
    return 'hidden'
  }
}

/** The profile menu's setting. Changing it also resets every box on screen to the new default. */
export function useAmountsDefault() {
  const [value, setValue] = useState<AmountsDefault>(readAmountsDefault)
  const set = useCallback((v: AmountsDefault) => {
    setValue(v)
    try {
      if (v === 'hidden') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, v)
    } catch {
      // Storage unavailable: applies until reload.
    }
    window.dispatchEvent(new CustomEvent<AmountsDefault>(CHANGE_EVENT, { detail: v }))
  }, [])
  return { amountsDefault: value, setAmountsDefault: set }
}

/** One box's shown/hidden state: starts at the default, toggled by its own eye. */
export function useAmountsShown(): [boolean, () => void] {
  const [shown, setShown] = useState(() => readAmountsDefault() === 'shown')
  useEffect(() => {
    const onChange = (e: Event) => setShown((e as CustomEvent<AmountsDefault>).detail === 'shown')
    window.addEventListener(CHANGE_EVENT, onChange)
    return () => window.removeEventListener(CHANGE_EVENT, onChange)
  }, [])
  const toggle = useCallback(() => setShown((s) => !s), [])
  return [shown, toggle]
}
