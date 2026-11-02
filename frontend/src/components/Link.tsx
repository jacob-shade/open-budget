import type { AnchorHTMLAttributes } from 'react'
import { navigate } from '../router'

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }

/** An in-app link: navigates without reloading, but still opens in a new tab with Ctrl/Cmd-click. */
export function Link({ href, onClick, ...rest }: Props) {
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        navigate(href)
      }}
    />
  )
}
