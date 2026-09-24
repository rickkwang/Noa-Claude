import { describe, expect, test } from 'bun:test'
import {
  formatDiffPathForDisplay,
  getFileStatsWidth,
  getMaxPathWidth,
  getScrollbarThumb,
} from '../../../components/diff/DiffFileList.js'
import type { DiffFile } from '../../../hooks/useDiffData.js'

function file(overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path: 'src/a.ts',
    linesAdded: 0,
    linesRemoved: 0,
    isBinary: false,
    isLargeFile: false,
    isTruncated: false,
    isUntracked: false,
    ...overrides,
  } as DiffFile
}

describe('getFileStatsWidth', () => {
  test('matches the rendered stats text', () => {
    expect(getFileStatsWidth(file({ isUntracked: true }))).toBe('untracked'.length)
    expect(getFileStatsWidth(file({ isBinary: true }))).toBe('Binary file'.length)
    expect(getFileStatsWidth(file({ isLargeFile: true }))).toBe(
      'Large file modified'.length,
    )
    expect(getFileStatsWidth(file({ linesAdded: 12 }))).toBe('+12'.length)
    expect(getFileStatsWidth(file({ linesRemoved: 3 }))).toBe('-3'.length)
    expect(
      getFileStatsWidth(
        file({ linesAdded: 1234, linesRemoved: 567, isTruncated: true }),
      ),
    ).toBe('+1234 -567 (truncated)'.length)
  })
})

describe('getMaxPathWidth', () => {
  test('a full row never exceeds the row width, even with long stats', () => {
    const rowWidth = 76
    for (const f of [
      file({ isLargeFile: true }),
      file({ linesAdded: 12345, linesRemoved: 6789, isTruncated: true }),
      file({ linesAdded: 1 }),
    ]) {
      const used = 2 + getMaxPathWidth(rowWidth, f) + 1 + getFileStatsWidth(f)
      expect(used).toBeLessThanOrEqual(rowWidth)
    }
  })

  test('keeps a floor on narrow terminals', () => {
    expect(getMaxPathWidth(5, file({ isLargeFile: true }))).toBe(10)
  })
})

describe('getScrollbarThumb', () => {
  test('fills the track when nothing is hidden', () => {
    expect(getScrollbarThumb(3, 5, 0)).toEqual({ thumbStart: 0, thumbSize: 5 })
  })

  test('sits at the top, then the bottom, of the track', () => {
    expect(getScrollbarThumb(20, 5, 0)).toEqual({ thumbStart: 0, thumbSize: 1 })
    expect(getScrollbarThumb(20, 5, 15)).toEqual({ thumbStart: 4, thumbSize: 1 })
  })

  test('a mid-list thumb never touches either end', () => {
    for (let start = 1; start < 15; start++) {
      const { thumbStart, thumbSize } = getScrollbarThumb(20, 5, start)
      expect(thumbStart).toBeGreaterThanOrEqual(1)
      expect(thumbStart + thumbSize).toBeLessThanOrEqual(4)
    }
  })

  test('thumb size tracks the visible fraction and stays inside the track', () => {
    for (let start = 0; start <= 5; start++) {
      const { thumbStart, thumbSize } = getScrollbarThumb(10, 5, start)
      expect(thumbSize).toBe(3)
      expect(thumbStart + thumbSize).toBeLessThanOrEqual(5)
    }
  })
})

describe('formatDiffPathForDisplay', () => {
  test('keeps an ordinary path unchanged', () => {
    expect(formatDiffPathForDisplay('src/中文/a b.ts')).toBe('src/中文/a b.ts')
  })

  test('flattens tabs and newlines so a row stays one line', () => {
    expect(formatDiffPathForDisplay('a\tb\n\nc.ts')).toBe('a b c.ts')
  })

  test('drops ANSI escapes and hidden Unicode', () => {
    expect(formatDiffPathForDisplay('\x1b[31mred\x1b[0m.ts')).toBe('red.ts')
    expect(formatDiffPathForDisplay('a\u200bb\u202e.ts')).toBe('ab.ts')
  })
})
