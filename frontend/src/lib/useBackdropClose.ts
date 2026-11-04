import { useRef, type PointerEvent, type RefObject } from 'react'

/**
 * Closes a modal <dialog> on a click on its backdrop: only when the press both starts and ends
 * outside the dialog box. Dragging from inside (e.g. selecting text) and releasing outside, or the
 * other way round, doesn't close it. A modal dialog's backdrop is the <dialog> element itself, so
 * "outside" = the event's target is the dialog. (A `click` can't be used alone: when press and
 * release land on different elements, its target is their common ancestor, the dialog.)
 */
export function useBackdropClose(ref: RefObject<HTMLDialogElement | null>, onClose: () => void) {
  const pressedOnBackdrop = useRef(false)
  return {
    onPointerDown: (e: PointerEvent<HTMLDialogElement>) => {
      pressedOnBackdrop.current = e.target === ref.current
    },
    onPointerUp: (e: PointerEvent<HTMLDialogElement>) => {
      const close = pressedOnBackdrop.current && e.target === ref.current
      pressedOnBackdrop.current = false
      if (close) onClose()
    },
  }
}
