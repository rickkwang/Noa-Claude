import { describe, expect, test } from 'bun:test'
import { isOutputLineTruncated } from '../../utils/terminal.js'

describe('isOutputLineTruncated', () => {
  test('folds past three raw lines, with the one-extra-line allowance', () => {
    expect(isOutputLineTruncated('a\nb\nc\nd')).toBe(false)
    expect(isOutputLineTruncated('a\nb\nc\nd\ne')).toBe(true)
    expect(isOutputLineTruncated('a\nb\nc\nd\n')).toBe(false)
  })

  test('ignores non-string output', () => {
    expect(isOutputLineTruncated(undefined)).toBe(false)
    expect(isOutputLineTruncated([{ type: 'text', text: 'x' }])).toBe(false)
  })

  test('a single long line only folds when columns are known', () => {
    // columns 50 → wrap width 40 → 4 visible rows = 160 chars
    const line = 'x'.repeat(200)
    expect(isOutputLineTruncated(line)).toBe(false)
    expect(isOutputLineTruncated(line, 50)).toBe(true)
    expect(isOutputLineTruncated('x'.repeat(160), 50)).toBe(false)
  })

  test('a short run of wide characters still folds by display width', () => {
    // 150 CJK chars = 300 columns > 160 at wrap width 40
    expect(isOutputLineTruncated('中'.repeat(150), 50)).toBe(true)
    expect(isOutputLineTruncated('中'.repeat(80), 50)).toBe(false)
  })

  test('wrapped rows across a few lines count toward the fold', () => {
    const wrapped = `${'x'.repeat(90)}\n${'y'.repeat(90)}`
    expect(isOutputLineTruncated(wrapped)).toBe(false)
    expect(isOutputLineTruncated(wrapped, 50)).toBe(true)
    expect(isOutputLineTruncated('short\nlines', 50)).toBe(false)
  })

  test('content past the pre-truncation budget always folds', () => {
    expect(isOutputLineTruncated('ab'.repeat(300), 50)).toBe(true)
  })
})
