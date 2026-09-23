import { type RefObject, useCallback, useMemo, useRef, useState } from 'react'
import type { DOMElement } from '../../ink/dom.js'
import type { WheelEvent } from '../../ink/events/wheel-event.js'
import { hitTest } from '../../ink/hit-test.js'

// Trackpad momentum from scrolling the transcript keeps arriving for a beat
// after a dialog opens over it; without this it would scroll the new list.
const MOUNT_SETTLE_MS = 300

type SelectWheelProps = {
  isDisabled: boolean
  visibleFromIndex: number
  visibleToIndex: number
  optionCount: number
  scrollViewport: (delta: number) => boolean
}

/**
 * Wheel over a Select whose options don't all fit scrolls its viewport.
 * Wheel events only reach Box handlers in fullscreen (alternate screen);
 * elsewhere the list keeps its keyboard-only behavior. Spread the result
 * onto the Box that wraps the option rows.
 */
export function useSelectWheel({
  isDisabled,
  visibleFromIndex,
  visibleToIndex,
  optionCount,
  scrollViewport,
}: SelectWheelProps): {
  ref: RefObject<DOMElement | null>
  onWheel: ((event: WheelEvent) => void) | undefined
} {
  const ref = useRef<DOMElement | null>(null)
  const [mountedAt] = useState(() => Date.now())
  const onWheel = useCallback(
    (event: WheelEvent) => {
      if (event.deltaY === 0) return
      const node = ref.current
      if (node !== null && hitTest(node, event.col, event.row) === null) return
      // The list claims the wheel even at its ends, so a notch past the last
      // option doesn't scroll the transcript behind the dialog instead.
      event.preventDefault()
      if (Date.now() - mountedAt < MOUNT_SETTLE_MS) return
      if (scrollViewport(event.deltaY > 0 ? 1 : -1)) {
        event.stopImmediatePropagation()
      }
    },
    [mountedAt, scrollViewport],
  )
  const enabled = !isDisabled && visibleToIndex - visibleFromIndex < optionCount
  return useMemo(
    () => ({ ref, onWheel: enabled ? onWheel : undefined }),
    [enabled, onWheel],
  )
}
