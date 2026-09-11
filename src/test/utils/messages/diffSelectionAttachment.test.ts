import { describe, expect, test } from 'bun:test'
import { normalizeAttachmentForAPI } from '../../../utils/messages.js'

/**
 * A diff-panel selection is a separate attachment type from an IDE one
 * precisely because it has no line numbers — the panel renders hunks, not
 * files, so "lines 40 to 46 of foo.ts" would be a number we made up. These
 * pin the shape of what the model is actually told.
 */

/**
 * `normalizeAttachmentForAPI` lives in a @ts-nocheck module, so its return type
 * doesn't survive the import — collect the text structurally instead of
 * destructuring a shape the compiler can't vouch for.
 */
function renderedText(attachment: unknown): string {
  const collect = (value: unknown, out: string[]): void => {
    if (typeof value === 'string') {
      out.push(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item, out)
      return
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      if (typeof record.text === 'string') out.push(record.text)
      if (record.content !== undefined) collect(record.content, out)
      if (record.message !== undefined) collect(record.message, out)
    }
  }
  const out: string[] = []
  collect(
    (normalizeAttachmentForAPI as (a: unknown) => unknown)(attachment),
    out,
  )
  return out.join('\n')
}

describe('selected_lines_in_diff', () => {
  test('reports the line count and the file, without inventing line numbers', () => {
    const text = renderedText({
      type: 'selected_lines_in_diff',
      lineCount: 3,
      content: '-  const a = 1\n+  const a = 2\n   return a',
      filePath: 'src/thing.ts',
    })

    expect(text).toContain(
      'The user selected the following 3 lines from the diff view (in src/thing.ts):',
    )
    expect(text).toContain('+  const a = 2')
    expect(text).toContain('This may or may not be related to the current task.')
    expect(text).not.toMatch(/lines \d+ to \d+/)
  })

  test('drops the parenthetical when the selection spans no single file', () => {
    const text = renderedText({
      type: 'selected_lines_in_diff',
      lineCount: 1,
      content: 'some header text',
    })

    expect(text).toContain(
      'The user selected the following 1 line from the diff view:',
    )
    expect(text).not.toContain('(in ')
  })

  test('truncates a selection past the 2000-char cap', () => {
    const text = renderedText({
      type: 'selected_lines_in_diff',
      lineCount: 400,
      content: 'x'.repeat(5000),
      filePath: 'big.ts',
    })

    expect(text).toContain('... (truncated)')
    expect(text.length).toBeLessThan(3000)
  })
})
