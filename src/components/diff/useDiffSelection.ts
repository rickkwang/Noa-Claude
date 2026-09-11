/**
 * Turn a text selection made inside the diff panel into context for the next
 * prompt, so "what about this?" can be typed straight after highlighting a few
 * lines of a hunk.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useIsOverlayActive } from '../../context/overlayContext.js'
import {
  usePromptOverlay,
  usePromptOverlayDialog,
} from '../../context/promptOverlayContext.js'
import type { DOMElement } from '../../ink/dom.js'
import { useSelection } from '../../ink/hooks/use-selection.js'
import { nodeCache } from '../../ink/node-cache.js'

/** What the panel hands to the prompt when the user selects inside it. */
export type DiffSelection = {
  source: 'diff'
  text: string
  lineCount: number
  filePath?: string
}

/**
 * The file whose rendered rect contains `row`, if any. Rects are screen
 * coordinates, scroll applied; rows above the scrolling body (the header)
 * belong to no file, even where a file scrolled half out of view still has
 * cells cached there.
 */
function fileAtRow(
  row: number,
  body: DOMElement | null,
  anchors: ReadonlyMap<string, DOMElement>,
): string | undefined {
  const bodyRect = body ? nodeCache.get(body) : undefined
  if (!bodyRect || row < bodyRect.y) return undefined
  for (const [path, node] of anchors) {
    const rect = nodeCache.get(node)
    if (rect && row >= rect.y && row < rect.y + rect.height) return path
  }
  return undefined
}

/**
 * Report selections made inside the panel to `onSelect` as they settle.
 *
 * "Inside the panel" is positional: both ends at or right of the panel's first
 * column and above its bottom edge. Selections are confined to the scope they
 * start in, so one begun in the transcript can't reach those columns. A drag
 * still in progress, a triple-click line selection (a copy gesture), or a
 * selection made while an overlay covers the screen is not offered.
 */
export function useDiffSelection({
  panelRef,
  bodyRef,
  minCol,
  anchors,
  onSelect,
}: {
  panelRef: React.RefObject<DOMElement | null>
  /** The panel's scrolling body; rows above it are header. */
  bodyRef: React.RefObject<DOMElement | null>
  /** The panel's first screen column. */
  minCol: number
  /** Per-file anchor nodes, used to attribute the selection to a file. */
  anchors: React.RefObject<Map<string, DOMElement>>
  /** Undefined disables the feature (no prompt to attach to). */
  onSelect: ((selection: DiffSelection) => void) | undefined
}): void {
  const selection = useSelection()
  const overlayActive = useIsOverlayActive()
  const promptOverlay = usePromptOverlay()
  const promptOverlayDialog = usePromptOverlayDialog()
  const covered =
    overlayActive ||
    (promptOverlay?.suggestions.length ?? 0) > 0 ||
    promptOverlayDialog != null
  const report = covered ? undefined : onSelect
  // The same selection is re-reported on every repaint while it stays on
  // screen; remember the last text so only a new one is offered.
  const lastReported = useRef('')

  const check = useCallback(() => {
    if (!report) return

    const state = selection.getState()
    if (state?.isDragging || !selection.hasSelection()) {
      lastReported.current = ''
      return
    }
    if (!state?.anchor || !state.focus || state.anchorSpan?.kind === 'line') {
      return
    }
    if (state.anchor.col < minCol || state.focus.col < minCol) return
    const panel = panelRef.current
    const rect = panel ? nodeCache.get(panel) : undefined
    const bottom = rect ? rect.y + rect.height : 0
    if (state.anchor.row >= bottom || state.focus.row >= bottom) return

    const text = selection.getSelectedText()
    if (!text.trim() || text === lastReported.current) return
    lastReported.current = text

    report({
      source: 'diff',
      text,
      lineCount: text.trimEnd().split('\n').length,
      filePath: fileAtRow(
        Math.min(state.anchor.row, state.focus.row),
        bodyRef.current,
        anchors.current,
      ),
    })
  }, [selection, panelRef, bodyRef, minCol, anchors, report])

  useEffect(() => selection.subscribe(check), [selection, check])
}
