import { describe, expect, test } from 'bun:test'
import {
  formatFallbackToolError,
  isFallbackToolErrorFolded,
} from '../../components/FallbackToolUseErrorMessage.js'

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')

describe('isFallbackToolErrorFolded', () => {
  test('folds past ten rendered lines', () => {
    expect(isFallbackToolErrorFolded(lines(10))).toBe(false)
    expect(isFallbackToolErrorFolded(lines(11))).toBe(true)
  })

  test('a trailing newline is trimmed before counting', () => {
    expect(isFallbackToolErrorFolded(`${lines(10)}\n`)).toBe(false)
  })

  test('error tags are stripped before counting', () => {
    expect(
      isFallbackToolErrorFolded(`<tool_use_error>${lines(10)}\n</tool_use_error>`),
    ).toBe(false)
  })

  test('array content renders as one line', () => {
    const blocks = [{ type: 'text' as const, text: lines(30) }]
    expect(formatFallbackToolError(blocks, false)).toBe('Tool execution failed')
    expect(isFallbackToolErrorFolded(blocks)).toBe(false)
  })

  test('input validation errors collapse to one line', () => {
    expect(
      isFallbackToolErrorFolded(`InputValidationError: bad\n${lines(20)}`),
    ).toBe(false)
  })
})
