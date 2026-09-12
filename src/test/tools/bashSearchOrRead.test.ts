import { describe, expect, test } from 'bun:test'
import {
  BashTool,
  isSearchOrReadBashCommand,
} from '../../tools/BashTool/BashTool.js'

// Both layers are memoized (per command string, and per tool_use input object
// in BashTool.isSearchOrReadCommand) because collapseReadSearchGroups calls
// them twice per Bash message on every render of the message list. These cases
// pin the classification and, by interleaving distinct commands, that neither
// cache returns another command's answer.
describe('isSearchOrReadBashCommand', () => {
  const cases: [string, boolean, boolean, boolean][] = [
    // command, isSearch, isRead, isList
    ['rg foo', true, false, false],
    ['cat a.txt', false, true, false],
    ['ls -la', false, false, true],
    ['cat a.txt | rg x', true, true, false],
    ['git status --porcelain', false, false, false],
    ['echo hi', false, false, false],
    ['git status && ls', false, false, false],
  ]

  test.each(cases)('%s', (command, isSearch, isRead, isList) => {
    expect(isSearchOrReadBashCommand(command)).toEqual({
      isSearch,
      isRead,
      isList,
    })
  })

  test('interleaved commands keep their own results', () => {
    for (let i = 0; i < 3; i++) {
      for (const [command, isSearch, isRead, isList] of cases) {
        expect(isSearchOrReadBashCommand(command)).toEqual({
          isSearch,
          isRead,
          isList,
        })
      }
    }
  })
})

describe('BashTool.isSearchOrReadCommand', () => {
  test('caches per input object without crossing commands', () => {
    const search = { command: 'rg foo' }
    const other = { command: 'git push' }

    expect(BashTool.isSearchOrReadCommand(search).isSearch).toBe(true)
    expect(BashTool.isSearchOrReadCommand(other).isSearch).toBe(false)
    // Second pass reads from the cache.
    expect(BashTool.isSearchOrReadCommand(search).isSearch).toBe(true)
    expect(BashTool.isSearchOrReadCommand(other).isSearch).toBe(false)
  })

  test('input missing a command is not search or read', () => {
    // Reached at runtime with unvalidated input from the transcript, so the
    // cast is the point of the case.
    const malformed = {} as Parameters<
      NonNullable<typeof BashTool.isSearchOrReadCommand>
    >[0]
    expect(BashTool.isSearchOrReadCommand(malformed)).toEqual({
      isSearch: false,
      isRead: false,
      isList: false,
    })
  })
})
