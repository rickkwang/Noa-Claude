// @ts-nocheck
import { useContext, useMemo, useSyncExternalStore } from 'react'
import StdinContext from '../components/StdinContext.js'
import instances from '../instances.js'
import type { FocusMove, SelectionState } from '../selection.js'

/**
 * Access to text selection operations on the Ink instance (fullscreen only).
 * Returns no-op functions when fullscreen mode is disabled.
 */
export function useSelection(): {
  copySelection: () => string
  /** Copy without clearing the highlight (for copy-on-select). */
  copySelectionNoClear: () => string
  clearSelection: () => void
  hasSelection: () => boolean
  /** Read the raw mutable selection state (for drag-to-scroll). */
  getState: () => SelectionState | null
  /** The selected text, without copying it to the clipboard. */
  getSelectedText: () => string
  /** Subscribe to selection mutations (start/update/finish/clear). */
  subscribe: (cb: () => void) => () => void
  /** Keyboard selection extension (shift+arrow): move focus, anchor fixed.
   *  Left/right wrap across rows; up/down clamp at viewport edges. */
  moveFocus: (move: FocusMove) => void
  /** Set the selection highlight bg color (theme-piping; solid bg
   *  replaces the old SGR-7 inverse so syntax highlighting stays readable
   *  under selection). Call once on mount + whenever theme changes. */
  setSelectionBgColor: (color: string) => void
} {
  // Look up the Ink instance via stdout — same pattern as instances map.
  // StdinContext is available (it's always provided), and the Ink instance
  // is keyed by stdout which we can get from process.stdout since there's
  // only one Ink instance per process in practice.
  useContext(StdinContext) // anchor to App subtree for hook rules
  const ink = instances.get(process.stdout)
  // Memoize so callers can safely use the return value in dependency arrays.
  // ink is a singleton per stdout — stable across renders.
  return useMemo(() => {
    if (!ink) {
      return {
        copySelection: () => '',
        copySelectionNoClear: () => '',
        clearSelection: () => {},
        hasSelection: () => false,
        getState: () => null,
        getSelectedText: () => '',
        subscribe: () => () => {},
        moveFocus: () => {},
        setSelectionBgColor: () => {},
      }
    }
    return {
      copySelection: () => ink.copySelection(),
      copySelectionNoClear: () => ink.copySelectionNoClear(),
      clearSelection: () => ink.clearTextSelection(),
      hasSelection: () => ink.hasTextSelection(),
      getState: () => ink.selection,
      getSelectedText: () => ink.getSelectedText(),
      subscribe: (cb: () => void) => ink.subscribeToSelectionChange(cb),
      moveFocus: (move: FocusMove) => ink.moveSelectionFocus(move),
      setSelectionBgColor: (color: string) => ink.setSelectionBgColor(color),
    }
  }, [ink])
}

const NO_SUBSCRIBE = () => () => {}
const ALWAYS_FALSE = () => false

/**
 * Delete-handler registry bridging the fullscreen scroll layer and the
 * prompt input (upstream parity: Backspace/Delete on an active selection
 * deletes the selected span when it lies fully inside the input box). The
 * input registers a handler; the scroll key handler offers the key to it
 * before the key falls through to normal input editing.
 */
type SelectionDeleteHandler = (selection: SelectionState) => boolean
let selectionDeleteHandler: SelectionDeleteHandler | null = null

export function setSelectionDeleteHandler(
  handler: SelectionDeleteHandler | null,
): void {
  selectionDeleteHandler = handler
}

export function tryDeleteSelection(selection: SelectionState): boolean {
  return selectionDeleteHandler?.(selection) ?? false
}

/**
 * Reactive selection-exists state. Re-renders the caller when a text
 * selection is created or cleared. Always returns false outside
 * fullscreen mode (selection is only available in alt-screen).
 */
export function useHasSelection(): boolean {
  useContext(StdinContext)
  const ink = instances.get(process.stdout)
  return useSyncExternalStore(
    ink ? ink.subscribeToSelectionChange : NO_SUBSCRIBE,
    ink ? ink.hasTextSelection : ALWAYS_FALSE,
  )
}
