import { describe, expect, test } from 'bun:test'
import Output from '../../ink/output.js'
import {
  CellWidth,
  CharPool,
  cellAt,
  createScreen,
  HyperlinkPool,
  type Screen,
  StylePool,
} from '../../ink/screen.js'

/**
 * flushBuffer() takes a printable-ASCII fast path that skips Intl.Segmenter
 * and stringWidth(). These pin the boundary: the fast path must agree with
 * the segmenter path cell-for-cell, and anything outside 0x20-0x7E must still
 * go through the segmenter (grapheme clusters, wide chars, combining marks).
 */

function paint(text: string): Screen {
  const stylePool = new StylePool()
  const screen = createScreen(
    40,
    1,
    stylePool,
    new CharPool(),
    new HyperlinkPool(),
  )
  const output = new Output({ width: 40, height: 1, stylePool, screen })
  output.write(0, 0, text)
  return output.get()
}

function row(screen: Screen): { char: string; width: number }[] {
  const cells: { char: string; width: number }[] = []
  for (let x = 0; x < screen.width; x++) {
    const cell = cellAt(screen, x, 0)!
    if (cell.width === CellWidth.Narrow && cell.char === ' ') continue
    cells.push({ char: cell.char, width: cell.width })
  }
  return cells
}

describe('Output printable-ASCII fast path', () => {
  test('plain ASCII lands one char per narrow cell', () => {
    expect(row(paint('abc'))).toEqual([
      { char: 'a', width: CellWidth.Narrow },
      { char: 'b', width: CellWidth.Narrow },
      { char: 'c', width: CellWidth.Narrow },
    ])
  })

  test('ASCII split across SGR runs still lands one char per cell', () => {
    const screen = paint('a\x1b[31mb\x1b[39mc')
    expect(row(screen).map(c => c.char)).toEqual(['a', 'b', 'c'])
    // The three chars carry two distinct styles (default, red, default).
    expect(cellAt(screen, 0, 0)!.styleId).not.toBe(cellAt(screen, 1, 0)!.styleId)
    expect(cellAt(screen, 0, 0)!.styleId).toBe(cellAt(screen, 2, 0)!.styleId)
  })

  test('CJK stays wide and claims two cells', () => {
    const screen = paint('a\u4f60b')
    expect(cellAt(screen, 0, 0)).toMatchObject({
      char: 'a',
      width: CellWidth.Narrow,
    })
    expect(cellAt(screen, 1, 0)).toMatchObject({
      char: '\u4f60',
      width: CellWidth.Wide,
    })
    expect(cellAt(screen, 2, 0)!.width).toBe(CellWidth.SpacerTail)
    expect(cellAt(screen, 3, 0)).toMatchObject({
      char: 'b',
      width: CellWidth.Narrow,
    })
  })

  test('multi-code-point emoji stays a single cluster', () => {
    // Family emoji: 4 people joined by ZWJ — one grapheme, one wide cell.
    const screen = paint('\u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}x')
    expect(cellAt(screen, 0, 0)!.char).toBe(
      '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}',
    )
    expect(cellAt(screen, 0, 0)!.width).toBe(CellWidth.Wide)
    expect(cellAt(screen, 2, 0)!.char).toBe('x')
  })

  test('combining mark clusters onto its ASCII base', () => {
    const screen = paint('e\u0301x')
    expect(cellAt(screen, 0, 0)!.char).toBe('e\u0301')
    expect(cellAt(screen, 1, 0)!.char).toBe('x')
  })

  test('tab expands to the next tab stop, not a literal cell', () => {
    const screen = paint('a\tb')
    expect(cellAt(screen, 0, 0)!.char).toBe('a')
    for (let x = 1; x < 8; x++) expect(cellAt(screen, x, 0)!.char).toBe(' ')
    expect(cellAt(screen, 8, 0)!.char).toBe('b')
  })
})
