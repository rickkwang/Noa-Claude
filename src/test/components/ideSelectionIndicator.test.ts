import { describe, expect, test } from 'bun:test'
import { describeSelection } from '../../components/IdeStatusIndicator.js'

describe('describeSelection', () => {
  test('a diff selection shows without an IDE and names its file', () => {
    expect(
      describeSelection(null, {
        source: 'diff',
        text: 'a\nb',
        lineCount: 2,
        filePath: 'src/deep/thing.ts',
      }),
    ).toBe('⧉ 2 lines from thing.ts')
    expect(
      describeSelection('disconnected', { source: 'diff', text: 'a', lineCount: 1 }),
    ).toBe('⧉ 1 line from diff')
  })

  test('an IDE selection needs a connected IDE', () => {
    const selection = { text: 'x', lineCount: 3, filePath: '/a/b.ts', lineStart: 1 }
    expect(describeSelection('disconnected', selection)).toBeNull()
    expect(describeSelection('connected', selection)).toBe('⧉ 3 lines selected')
    expect(describeSelection('connected', { lineCount: 0, filePath: '/a/b.ts' })).toBe(
      '⧉ In b.ts',
    )
  })
})
