import { describe, expect, test } from 'bun:test'
import { isBashResultTruncated } from '../../../tools/BashTool/utils.js'

describe('isBashResultTruncated', () => {
  test('stdout past the fold is truncated', () => {
    expect(isBashResultTruncated('1\n2\n3\n4\n5', '')).toBe(true)
    expect(isBashResultTruncated('1\n2\n3', '')).toBe(false)
  })

  test('stderr ignores content BashToolResultMessage renders separately', () => {
    const violations =
      '<sandbox_violations>\na\nb\nc\nd\ne\n</sandbox_violations>'
    expect(isBashResultTruncated('', `oops\n${violations}`)).toBe(false)
    expect(
      isBashResultTruncated('', 'e1\ne2\ne3\ne4\nShell cwd was reset to /tmp'),
    ).toBe(false)
    expect(isBashResultTruncated('', 'e1\ne2\ne3\ne4\ne5')).toBe(true)
  })

  test('passes columns through for wrapped lines', () => {
    expect(isBashResultTruncated('x'.repeat(200), '')).toBe(false)
    expect(isBashResultTruncated('x'.repeat(200), '', 50)).toBe(true)
  })
})
