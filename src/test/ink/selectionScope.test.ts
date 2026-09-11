import { describe, expect, test } from 'bun:test'
import {
  CellWidth,
  CharPool,
  createScreen,
  HyperlinkPool,
  setCellAt,
  StylePool,
} from '../../ink/screen.js'
import {
  captureScrolledRows,
  createSelectionState,
  finishSelection,
  getSelectedText,
  selectLineAt,
  shiftSelection,
  startSelection,
  updateSelection,
} from '../../ink/selection.js'

/** A 20x3 screen: "transcript" text in columns 0-9, "panel" text in 10-19. */
function splitScreen() {
  const screen = createScreen(
    20,
    3,
    new StylePool(),
    new CharPool(),
    new HyperlinkPool(),
  )
  const rows = [
    ['left-one  ', 'right-one '],
    ['left-two  ', 'right-two '],
    ['left-three', 'right-thre'],
  ]
  rows.forEach(([left, right], y) => {
    ;[...(left! + right!)].forEach((char, x) => {
      setCellAt(screen, x, y, {
        char,
        styleId: screen.emptyStyleId,
        width: CellWidth.Narrow,
        hyperlink: undefined,
      })
    })
  })
  return screen
}

const panelScope = { x1: 10, x2: 20, node: {} }

describe('selection scope', () => {
  test('unscoped multi-row selections span the whole screen row', () => {
    const screen = splitScreen()
    const s = createSelectionState()
    startSelection(s, 12, 0)
    updateSelection(s, 13, 1)
    expect(getSelectedText(s, screen)).toBe('ght-one\nleft-two  righ')
  })

  test('scoped selections stay inside the scope columns on every row', () => {
    const screen = splitScreen()
    const s = createSelectionState()
    startSelection(s, 12, 0, panelScope)
    updateSelection(s, 13, 2)
    expect(getSelectedText(s, screen)).toBe('ght-one\nright-two\nrigh')
  })

  test('a drag past the scope edge clamps to it', () => {
    const s = createSelectionState()
    startSelection(s, 12, 0, panelScope)
    updateSelection(s, 3, 1)
    expect(s.focus).toEqual({ col: 10, row: 1 })
  })

  test('line selection covers the scope, not the row', () => {
    const screen = splitScreen()
    const s = createSelectionState()
    startSelection(s, 15, 1, panelScope)
    selectLineAt(s, screen, 1)
    expect(getSelectedText(s, screen)).toBe('right-two')
  })

  test('a scoped selection follows a scroll and keeps the rows it leaves', () => {
    const screen = splitScreen()
    const s = createSelectionState()
    startSelection(s, 10, 0, panelScope)
    updateSelection(s, 18, 1)
    finishSelection(s)
    // Content moves up one row: row 0 leaves the top of the viewport.
    captureScrolledRows(s, screen, 0, 0, 'above')
    shiftSelection(s, -1, 0, 2, 20)
    expect(s.anchor).toEqual({ col: 10, row: 0 })
    expect(s.focus).toEqual({ col: 18, row: 0 })
    expect(s.scrolledOffAbove).toEqual(['right-one'])
  })

  test('focus parked past the edge by keyboard extension shifts back without captured rows', () => {
    const s = createSelectionState()
    startSelection(s, 12, 1, panelScope)
    updateSelection(s, 14, 0)
    finishSelection(s)
    s.virtualFocusRow = -1
    expect(() => shiftSelection(s, 1, 0, 2, 20)).not.toThrow()
    expect(s.focus).toEqual({ col: 14, row: 0 })
    expect(s.anchor).toEqual({ col: 12, row: 2 })
    expect(s.scrolledOffAbove).toEqual([])
  })
})
