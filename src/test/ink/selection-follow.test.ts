import { describe, expect, test } from 'bun:test'
import {
  CellWidth,
  CharPool,
  HyperlinkPool,
  StylePool,
  createScreen,
  setCellAt,
  type Screen,
} from '../../ink/screen.js'
import {
  createSelectionState,
  getSelectedText,
  isSelectionFullyOvershot,
  shiftAnchor,
  shiftSelectionForFollow,
  captureScrolledRows,
  type SelectionState,
} from '../../ink/selection.js'

// Viewport: 10 cols × 5 rows. Content rows are 10-char strings "l0........"
// so extractRowText's trailing-trim never kicks in.
const W = 10
const H = 5

function makeScreen(firstLabel: number): Screen {
  const screen = createScreen(W, H, new StylePool(), new CharPool(), new HyperlinkPool())
  for (let row = 0; row < H; row++) {
    const text = `l${firstLabel + row}........`
    for (let col = 0; col < W; col++) {
      setCellAt(screen, col, row, {
        char: text[col]!,
        styleId: screen.emptyStyleId,
        width: CellWidth.Narrow,
        hyperlink: undefined,
      })
    }
  }
  return screen
}

// Simulate the frame's content scroll AFTER the selection consumption ran
// (consumption reads the pre-swap buffer, then the new frame lands).
function scrollContent(screen: Screen, firstLabel: number): void {
  for (let row = 0; row < H; row++) {
    const text = `l${firstLabel + row}........`
    for (let col = 0; col < W; col++) {
      setCellAt(screen, col, row, {
        char: text[col]!,
        styleId: screen.emptyStyleId,
        width: CellWidth.Narrow,
        hyperlink: undefined,
      })
    }
  }
}

function select(s: SelectionState, anchor: [number, number], focus: [number, number]): void {
  s.anchor = { col: anchor[0], row: anchor[1] }
  s.focus = { col: focus[0], row: focus[1] }
  s.isDragging = false
}

describe('shiftSelectionForFollow (upstream otp port)', () => {
  test('clamps at the top edge with virtual row/col tracking, restores on reverse', () => {
    const s = createSelectionState()
    select(s, [2, 1], [4, 2])

    shiftSelectionForFollow(s, -3, 0, H - 1, W)
    expect(s.anchor).toEqual({ col: 0, row: 0 })
    expect(s.focus).toEqual({ col: 0, row: 0 })
    expect(s.virtualAnchorRow).toBe(-2)
    expect(s.virtualAnchorCol).toBe(2)
    expect(s.virtualFocusRow).toBe(-1)
    expect(s.virtualFocusCol).toBe(4)
    expect(isSelectionFullyOvershot(s)).toBe(true)

    shiftSelectionForFollow(s, 2, 0, H - 1, W)
    expect(s.anchor).toEqual({ col: 2, row: 0 })
    expect(s.focus).toEqual({ col: 4, row: 1 })
    expect(s.virtualAnchorRow).toBeUndefined()
    expect(s.virtualAnchorCol).toBeUndefined()
    expect(isSelectionFullyOvershot(s)).toBe(false)
  })

  test('clamped-to-bottom endpoints reset col to the far edge', () => {
    const s = createSelectionState()
    select(s, [2, 1], [4, 2])
    shiftSelectionForFollow(s, 10, 0, H - 1, W)
    expect(s.anchor).toEqual({ col: W - 1, row: H - 1 })
    expect(s.focus).toEqual({ col: W - 1, row: H - 1 })
    expect(s.virtualAnchorRow).toBe(11)
    expect(isSelectionFullyOvershot(s)).toBe(true)
  })

  test('pops above-accumulator rows as they re-enter the viewport', () => {
    const s = createSelectionState()
    select(s, [0, 0], [9, 0])
    s.virtualAnchorRow = -3
    s.virtualAnchorCol = 5
    s.virtualFocusRow = -2
    s.virtualFocusCol = 7
    s.scrolledOffAbove = ['l0', 'l1']
    s.scrolledOffAboveSW = [false, false]

    // +1: span -3..-2 → -2..-1, still fully above — no pop.
    shiftSelectionForFollow(s, 1, 0, H - 1, W)
    expect(s.scrolledOffAbove).toEqual(['l0', 'l1'])

    // +2 more: span re-enters (rows 0..1 in bounds) — both rows pop.
    shiftSelectionForFollow(s, 2, 0, H - 1, W)
    expect(s.scrolledOffAbove).toEqual([])
    expect(s.anchor).toEqual({ col: 5, row: 0 })
    expect(s.focus).toEqual({ col: 7, row: 1 })
  })

  test('full pass-through swaps the below accumulator to above', () => {
    const s = createSelectionState()
    select(s, [0, H - 1], [9, H - 1])
    s.virtualAnchorRow = 6
    s.virtualFocusRow = 7
    s.scrolledOffBelow = ['r5', 'r6', 'r7']
    s.scrolledOffBelowSW = [false, false, false]

    shiftSelectionForFollow(s, -10, 0, H - 1, W)
    // Swapped, then capped to the actual above-count (2).
    expect(s.scrolledOffAbove).toEqual(['r6', 'r7'])
    expect(s.scrolledOffBelow).toEqual([])
    expect(s.virtualAnchorRow).toBe(-4)
    expect(isSelectionFullyOvershot(s)).toBe(true)
  })

  test('never clears the selection, even when fully overshot', () => {
    const s = createSelectionState()
    select(s, [0, 0], [9, 1])
    shiftSelectionForFollow(s, -100, 0, H - 1, W)
    expect(s.anchor).not.toBeNull()
    expect(s.focus).not.toBeNull()
    expect(isSelectionFullyOvershot(s)).toBe(true)
  })
})

describe('shiftAnchor (upstream itp port)', () => {
  test('tracks virtual col through clamp and restore', () => {
    const s = createSelectionState()
    s.anchor = { col: 3, row: 1 }
    s.isDragging = true

    shiftAnchor(s, -3, 0, H - 1)
    expect(s.anchor).toEqual({ col: 3, row: 0 })
    expect(s.virtualAnchorRow).toBe(-2)
    expect(s.virtualAnchorCol).toBe(3)

    shiftAnchor(s, 2, 0, H - 1)
    expect(s.anchor).toEqual({ col: 3, row: 0 })
    expect(s.virtualAnchorRow).toBeUndefined()
    expect(s.virtualAnchorCol).toBeUndefined()
  })
})

describe('getSelectedText overshoot guard', () => {
  test('skips the visible read when fully overshot — no decoy row spliced in', () => {
    const screen = makeScreen(10) // visible rows: l10..l14
    const s = createSelectionState()
    select(s, [0, 0], [9, 0])
    s.virtualAnchorRow = -2
    s.virtualFocusRow = -1
    s.scrolledOffAbove = ['l8........', 'l9........']
    s.scrolledOffAboveSW = [false, false]

    expect(isSelectionFullyOvershot(s)).toBe(true)
    expect(getSelectedText(s, screen)).toBe('l8........\nl9........')
  })
})

describe('capture+shift pairing across drain frames (wheel model)', () => {
  test('selection text survives scrolling off the top and back, no duplication', () => {
    let screen = makeScreen(0) // l0..l4 visible
    const s = createSelectionState()
    select(s, [0, 1], [9, 2]) // selects l1 + l2

    // Frame 1: wheel down, content up 1. Band [0,0] misses the selection.
    captureScrolledRows(s, screen, 0, 0, 'above')
    shiftSelectionForFollow(s, -1, 0, H - 1, W)
    scrollContent(screen, 1) // l1..l5

    // Frame 2: band [0,0] now intersects → captures l1.
    captureScrolledRows(s, screen, 0, 0, 'above')
    shiftSelectionForFollow(s, -1, 0, H - 1, W)
    scrollContent(screen, 2) // l2..l6

    // Frame 3: captures l2; both ends clamp off the top.
    captureScrolledRows(s, screen, 0, 0, 'above')
    shiftSelectionForFollow(s, -1, 0, H - 1, W)
    scrollContent(screen, 3) // l3..l7

    expect(s.scrolledOffAbove).toEqual(['l1........', 'l2........'])
    expect(isSelectionFullyOvershot(s)).toBe(true)
    expect(getSelectedText(s, screen)).toBe('l1........\nl2........')

    // Frame 4: wheel up, content down 1 (band at bottom misses). l2 re-enters.
    captureScrolledRows(s, screen, H - 1, H - 1, 'below')
    shiftSelectionForFollow(s, 1, 0, H - 1, W)
    scrollContent(screen, 2) // l2..l6

    expect(s.scrolledOffAbove).toEqual(['l1........'])
    expect(isSelectionFullyOvershot(s)).toBe(false)
    expect(getSelectedText(s, screen)).toBe('l1........\nl2........')

    // Frame 5: l1 re-enters too — accumulator empties, text all on-screen.
    captureScrolledRows(s, screen, H - 1, H - 1, 'below')
    shiftSelectionForFollow(s, 1, 0, H - 1, W)
    scrollContent(screen, 1) // l1..l5

    expect(s.scrolledOffAbove).toEqual([])
    expect(getSelectedText(s, screen)).toBe('l1........\nl2........')
    // Viewport shows l1..l5 — l1 sits at row 0.
    expect(s.anchor).toEqual({ col: 0, row: 0 })
    expect(s.focus).toEqual({ col: 9, row: 1 })

    // Frame 6: one more row down fully restores the original positions.
    captureScrolledRows(s, screen, H - 1, H - 1, 'below')
    shiftSelectionForFollow(s, 1, 0, H - 1, W)
    scrollContent(screen, 0) // l0..l4

    expect(s.anchor).toEqual({ col: 0, row: 1 })
    expect(s.focus).toEqual({ col: 9, row: 2 })
    expect(getSelectedText(s, screen)).toBe('l1........\nl2........')
  })
})

describe('captureScrolledRows (upstream zca port)', () => {
  test('is a no-op once the selection is fully overshot — no decoy rows accumulate', () => {
    const screen = makeScreen(10) // visible l10..l14
    const s = createSelectionState()
    // Both endpoints clamped at row 0, true positions above the viewport.
    select(s, [0, 0], [9, 0])
    s.virtualAnchorRow = -2
    s.virtualFocusRow = -1
    s.scrolledOffAbove = ['l8........', 'l9........']
    s.scrolledOffAboveSW = [false, false]
    expect(isSelectionFullyOvershot(s)).toBe(true)

    // The outgoing band IS the clamped row — without the gate it would
    // capture l10 (unrelated content) and the cap would then evict l8.
    captureScrolledRows(s, screen, 0, 0, 'above')

    expect(s.scrolledOffAbove).toEqual(['l8........', 'l9........'])
    expect(getSelectedText(s, screen)).toBe('l8........\nl9........')
  })

  test('records the pre-reset anchor col so a reverse scroll restores it', () => {
    const screen = makeScreen(0) // l0..l4
    const s = createSelectionState()
    select(s, [4, 1], [9, 2]) // anchor mid-row on l1, focus at end of l2

    // Row 1 scrolls out the top: captured with its col constraint, then the
    // anchor col is reset to 0 so the next read takes the whole row.
    captureScrolledRows(s, screen, 1, 1, 'above')
    expect(s.scrolledOffAbove).toEqual(['......']) // cols 4..9 of "l1........"
    expect(s.anchor).toEqual({ col: 0, row: 1 })
    expect(s.virtualAnchorCol).toBe(4)

    // Reverse scroll brings it back in bounds — the true col returns.
    shiftSelectionForFollow(s, -2, 0, H - 1, W)
    shiftSelectionForFollow(s, 2, 0, H - 1, W)
    expect(s.anchor!.col).toBe(4)
  })
})

// The mechanism behind shift+↑/↓ at a viewport edge (ScrollKeybindingHandler's
// tryScrollExtendSelection, upstream's b()). It does NOT move the selection
// itself: it pins focus at the edge row and parks a virtual row ONE row
// beyond, then scrolls. The follow shift on the next frame moves the anchor
// with the content while the virtual row cancels the shift for focus — so
// focus stays put and the span grows by exactly one row. Pinning is a pure
// state mutation, so the whole round trip is testable without a renderer.
describe('scroll-to-extend pin (upstream b() + otp)', () => {
  test('shift+up: focus stays pinned at the top row, selection grows by one row', () => {
    const screen = makeScreen(2) // visible l2..l6 at rows 0..4
    const s = createSelectionState()
    select(s, [9, 1], [0, 0]) // anchor = end of l3, focus = start of l2 (at top edge)
    expect(getSelectedText(s, screen)).toBe('l2........\nl3........')

    // The handler's pin, verbatim: focus to the edge row, virtual one beyond.
    s.focus = { col: s.focus!.col, row: 0 }
    s.virtualFocusRow = -1
    s.virtualFocusCol = undefined

    // scrollBy(-1) drains: rendered delta -1 → ink.tsx shifts by +1 and
    // captures the band leaving the BOTTOM (row 4 = l6, outside the span).
    captureScrolledRows(s, screen, H - 1, H - 1, 'below')
    shiftSelectionForFollow(s, 1, 0, H - 1, W)
    scrollContent(screen, 1) // l1..l5

    // Focus pinned; anchor rode the content down one row.
    expect(s.focus).toEqual({ col: 0, row: 0 })
    expect(s.virtualFocusRow).toBeUndefined()
    expect(s.virtualFocusCol).toBeUndefined()
    expect(s.anchor).toEqual({ col: 9, row: 2 })
    expect(s.scrolledOffBelow).toEqual([])
    // Grew by exactly one row — l1 joined at the top, nothing lost.
    expect(getSelectedText(s, screen)).toBe('l1........\nl2........\nl3........')
  })

  test('shift+down: focus stays pinned at the bottom row, selection grows by one row', () => {
    const screen = makeScreen(2) // visible l2..l6 at rows 0..4
    const s = createSelectionState()
    select(s, [0, 3], [9, 4]) // anchor = start of l5, focus = end of l6 (at bottom edge)
    expect(getSelectedText(s, screen)).toBe('l5........\nl6........')

    s.focus = { col: s.focus!.col, row: H - 1 }
    s.virtualFocusRow = H
    s.virtualFocusCol = undefined

    // scrollBy(+1): rendered delta +1 → shift by -1, band leaving the TOP.
    captureScrolledRows(s, screen, 0, 0, 'above')
    shiftSelectionForFollow(s, -1, 0, H - 1, W)
    scrollContent(screen, 3) // l3..l7

    expect(s.focus).toEqual({ col: 9, row: H - 1 })
    expect(s.virtualFocusRow).toBeUndefined()
    expect(s.anchor).toEqual({ col: 0, row: 2 })
    expect(s.scrolledOffAbove).toEqual([])
    expect(getSelectedText(s, screen)).toBe('l5........\nl6........\nl7........')
  })
})
