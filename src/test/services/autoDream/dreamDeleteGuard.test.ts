import { describe, expect, test } from 'bun:test'
import { rewriteDreamDeleteCommand } from '../../../services/autoDream/autoDream.js'

const ROOT = '/mem/root'

describe('rewriteDreamDeleteCommand', () => {
  test('rewrites top-level topic deletes to absolute paths', () => {
    expect(rewriteDreamDeleteCommand('rm old.md', ROOT)).toBe(
      "rm -f -- '/mem/root/old.md'",
    )
    expect(rewriteDreamDeleteCommand('rm -f a.md b-2.md', ROOT)).toBe(
      "rm -f -- '/mem/root/a.md' '/mem/root/b-2.md'",
    )
  })

  test('quotes a memory root containing spaces and quotes', () => {
    expect(
      rewriteDreamDeleteCommand('rm a.md', "/mem/it's here"),
    ).toBe("rm -f -- '/mem/it'\\''s here/a.md'")
  })

  test.each([
    ['MEMORY.md (index must be overwritten, not deleted)', 'rm MEMORY.md'],
    ['path escaping the memory dir', 'rm ../x.md'],
    ['team subdirectory', 'rm team/x.md'],
    ['non-markdown file', 'rm x.txt'],
    ['recursive flag', 'rm -rf a.md'],
    ['chained second command', 'rm a.md; rm b.md'],
    ['command substitution', 'rm $(echo a).md'],
    ['no file argument', 'rm'],
    ['not an rm command', 'ls -la'],
    ['non-string input', undefined],
  ])('rejects %s', (_label, command) => {
    expect(rewriteDreamDeleteCommand(command, ROOT)).toBeNull()
  })
})
