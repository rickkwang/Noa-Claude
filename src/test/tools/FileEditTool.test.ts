// @ts-nocheck
import { describe, expect, test } from 'bun:test'
import { editStillAppliesCleanly } from '../../tools/FileEditTool/utils.js'

// Covers the stale-read rescue added to mirror upstream Claude Code's
// behavior: when a file's mtime moved past the last read, FileEditTool no
// longer forces a re-read if old_string still identifies a clean,
// unambiguous edit target in the file's *current* on-disk content.
describe('editStillAppliesCleanly', () => {
  test('false when old_string is empty (new-file-creation form)', () => {
    expect(editStillAppliesCleanly('const a = 1\n', '', false)).toBe(false)
  })

  test('false when old_string no longer appears at all', () => {
    expect(
      editStillAppliesCleanly('const a = 1\n', 'const b = 2', false),
    ).toBe(false)
  })

  test('true when old_string is the sole match and replace_all is off', () => {
    const content = 'line one\nline two\nline three\n'
    expect(editStillAppliesCleanly(content, 'line two', false)).toBe(true)
  })

  test('false when old_string matches more than once and replace_all is off', () => {
    const content = 'foo\nfoo\nbar\n'
    expect(editStillAppliesCleanly(content, 'foo', false)).toBe(false)
  })

  test('true when old_string matches more than once but replace_all is on', () => {
    const content = 'foo\nfoo\nbar\n'
    expect(editStillAppliesCleanly(content, 'foo', true)).toBe(true)
  })

  test('true via quote-normalized match (curly quotes in file)', () => {
    const content = 'const s = “hello”\n'
    expect(editStillAppliesCleanly(content, 'const s = "hello"', false)).toBe(
      true,
    )
  })
})
