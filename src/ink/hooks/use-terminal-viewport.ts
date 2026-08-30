// @ts-nocheck
import { useCallback, useContext, useLayoutEffect, useRef, useState } from 'react'
import { TerminalSizeContext, type TerminalSize } from '../components/TerminalSizeContext.js'
import type { DOMElement } from '../dom.js'

/**
 * How many visibility flips to allow before assuming the layout and this
 * hook's own state are feeding each other. React's own nested-update limit
 * is 50; staying well under it keeps the app alive instead of crashing.
 */
const MAX_VISIBILITY_FLIPS = 4

/**
 * The latch decision, split out from the effect so it can be tested without a
 * renderer: given what was published, what the layout just said, and how many
 * consecutive flips came before, decide what to publish now.
 *
 * `flips` is the running count of disagreements; it resets whenever the layout
 * agrees with the published state, and the caller resets it on a terminal
 * resize (the only external input the calculation has).
 */
export function nextViewportVisibility(
  published: boolean,
  measured: boolean,
  flips: number,
): { visible: boolean; flips: number } {
  if (measured === published) {
    // Settled: the layout agrees with the state we already published.
    return { visible: published, flips: 0 }
  }

  const nextFlips = flips + 1
  if (nextFlips > MAX_VISIBILITY_FLIPS) {
    // Oscillating. Latch on "visible": consumers then keep live content and
    // running animations, which costs redraws, not a wrong frame.
    return { visible: true, flips: nextFlips }
  }

  return { visible: measured, flips: nextFlips }
}

type ViewportEntry = {
  /**
   * Whether the element is currently within the terminal viewport
   */
  isVisible: boolean
}

/**
 * Hook to detect if a component is within the terminal viewport.
 *
 * Returns a callback ref and a viewport entry object.
 * Attach the ref to the component you want to track.
 *
 * Visibility transitions trigger a re-render via setState, so consumers that
 * gate work on `isVisible` (e.g. useAnimationFrame's subscription) reliably
 * pick up the new value. The setState only fires on true → false / false →
 * true transitions, so steady-state renders cost nothing.
 *
 * Why this matters: a ref-only notification (the previous design) left a
 * blind window after a SIGWINCH resize. If the resize made the spinner
 * briefly offscreen, useAnimationFrame would unsubscribe on the next tick,
 * the clock would pause, and a subsequent resize that restored visibility
 * would never reach the consumer — its `active` dep never flipped because
 * nothing scheduled the re-render that would have read the updated ref. The
 * spinner and elapsed-time counter would stay frozen until an unrelated
 * state change (keypress, etc.) re-rendered the component.
 *
 * @example
 * const [ref, entry] = useTerminalViewport()
 * return <Box ref={ref}><Animation enabled={entry.isVisible}>...</Animation></Box>
 */
export function useTerminalViewport(): [
  ref: (element: DOMElement | null) => void,
  entry: ViewportEntry,
] {
  const terminalSize = useContext(TerminalSizeContext)
  const elementRef = useRef<DOMElement | null>(null)
  const [entry, setEntry] = useState<ViewportEntry>({ isVisible: true })
  // Consumers (OffscreenFreeze, Ratchet) change their own layout based on
  // `isVisible`, so this hook's input is downstream of its own output: a
  // subtree that grows when visible can push itself back into scrollback,
  // flip to invisible, shrink, become visible again, and never settle. The
  // effect below runs on every commit, so an unbounded flip sequence is a
  // layout-effect setState loop — React aborts the whole app with "Maximum
  // update depth exceeded". Count consecutive flips and latch once they
  // exceed the budget; the latch releases when the terminal size changes,
  // which is the only external input the calculation has.
  const flipsRef = useRef(0)
  // Compared by value, not identity: App.tsx rebuilds the context object on
  // every render(), so identity would release the latch on any unrelated
  // root re-render, not just a real resize.
  const latchedSizeRef = useRef<TerminalSize | null>(null)
  // Mirrors the published `entry.isVisible` so the effect can decide whether
  // this commit is a flip without doing the bookkeeping inside the state
  // updater — React may call an updater more than once, and a side effect
  // there would double-count.
  const visibleRef = useRef(true)

  const setElement = useCallback((el: DOMElement | null) => {
    elementRef.current = el
  }, [])

  // Runs on every render because yoga layout values can change
  // without React being aware.
  // Walks the DOM ancestor chain fresh each time to avoid holding stale
  // references after yoga tree rebuilds.
  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element?.yogaNode || !terminalSize) {
      return
    }

    // A new terminal size is a genuine external change: forget the previous
    // oscillation and let the calculation drive visibility again.
    const latched = latchedSizeRef.current
    if (
      !latched ||
      latched.rows !== terminalSize.rows ||
      latched.columns !== terminalSize.columns
    ) {
      latchedSizeRef.current = terminalSize
      flipsRef.current = 0
    }

    if (flipsRef.current > MAX_VISIBILITY_FLIPS) {
      return
    }

    const height = element.yogaNode.getComputedHeight()
    const rows = terminalSize.rows

    // Walk the DOM parent chain (not yoga.getParent()) so we can detect
    // scroll containers and subtract their scrollTop. Yoga computes layout
    // positions without scroll offset — scrollTop is applied at render time.
    // Without this, an element inside a ScrollBox whose yoga position exceeds
    // terminalRows would be considered offscreen even when scrolled into view
    // (e.g., the spinner in fullscreen mode after enough messages accumulate).
    let absoluteTop = element.yogaNode.getComputedTop()
    let parent: DOMElement | undefined = element.parentNode
    let root = element.yogaNode
    while (parent) {
      if (parent.yogaNode) {
        absoluteTop += parent.yogaNode.getComputedTop()
        root = parent.yogaNode
      }
      // scrollTop is only ever set on scroll containers (by ScrollBox + renderer).
      // Non-scroll nodes have undefined scrollTop → falsy fast-path.
      if (parent.scrollTop) absoluteTop -= parent.scrollTop
      parent = parent.parentNode
    }

    // Only the root's height matters
    const screenHeight = root.getComputedHeight()

    const bottom = absoluteTop + height
    // When content overflows the viewport (screenHeight > rows), the
    // cursor-restore at frame end scrolls one extra row into scrollback.
    // log-update.ts accounts for this with scrollbackRows = viewportY + 1.
    // We must match, otherwise an element at the boundary is considered
    // "visible" here (animation keeps ticking) but its row is treated as
    // scrollback by log-update (content change → full reset → flicker).
    const cursorRestoreScroll = screenHeight > rows ? 1 : 0
    const viewportY = Math.max(0, screenHeight - rows) + cursorRestoreScroll
    const viewportBottom = viewportY + rows
    const visible = bottom > viewportY && absoluteTop < viewportBottom

    const next = nextViewportVisibility(visibleRef.current, visible, flipsRef.current)
    flipsRef.current = next.flips
    if (next.visible !== visibleRef.current) {
      visibleRef.current = next.visible
      setEntry({ isVisible: next.visible })
    }
  })

  return [setElement, entry]
}
