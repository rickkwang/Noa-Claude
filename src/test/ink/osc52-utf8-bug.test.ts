import { afterEach, describe, expect, test } from 'bun:test'
import { hasOsc52ClipboardUtf8Bug } from '../../ink/terminal.js'

const ORIGINAL_PROGRAM = process.env.TERM_PROGRAM
const ORIGINAL_VERSION = process.env.TERM_PROGRAM_VERSION

function setTerminal(program?: string, version?: string): void {
  if (program === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = program
  if (version === undefined) delete process.env.TERM_PROGRAM_VERSION
  else process.env.TERM_PROGRAM_VERSION = version
}

afterEach(() => setTerminal(ORIGINAL_PROGRAM, ORIGINAL_VERSION))

describe('hasOsc52ClipboardUtf8Bug', () => {
  test('covers exactly the affected VS Code range [1.123, 1.125)', () => {
    const affected = ['1.123.0', '1.123.7', '1.124.0', '1.124.99']
    for (const v of affected) {
      setTerminal('vscode', v)
      expect(hasOsc52ClipboardUtf8Bug()).toBe(true)
    }
    // 1.125 carries the fix; anything older never had the bug.
    const unaffected = ['1.122.9', '1.125.0', '1.126.0', '1.130.0', '1.99.0']
    for (const v of unaffected) {
      setTerminal('vscode', v)
      expect(hasOsc52ClipboardUtf8Bug()).toBe(false)
    }
  })

  test('is false for non-vscode terminals even in the affected range', () => {
    for (const program of ['iTerm.app', 'ghostty', 'WarpTerminal']) {
      setTerminal(program, '1.124.0')
      expect(hasOsc52ClipboardUtf8Bug()).toBe(false)
    }
  })

  test('is false when the version is missing or unparseable', () => {
    setTerminal('vscode', undefined)
    expect(hasOsc52ClipboardUtf8Bug()).toBe(false)
    setTerminal('vscode', 'not-a-version')
    expect(hasOsc52ClipboardUtf8Bug()).toBe(false)
  })

  test('is false when TERM_PROGRAM is unset', () => {
    setTerminal(undefined, '1.124.0')
    expect(hasOsc52ClipboardUtf8Bug()).toBe(false)
  })
})
