/**
 * Extract the file operand from a single-file grep command, or null if
 * the form is ambiguous or content-suppressing (not safe to register).
 */

import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'

const GREP_COMMANDS = new Set(['grep', 'egrep', 'fgrep'])

// Flags whose values consume positionals, making operand counting unreliable.
const OPERAND_AMBIGUOUS_SHORT_FLAGS = new Set([
  'r', 'R', // recursive
  'e', 'f', // pattern / file-of-patterns from a value
  'm', // max-count (value)
  'A', 'B', 'C', // context lines (value)
  'd', 'D', // directory / device actions (value)
])

// Flags that print no editable lines — registering would bypass the read check.
const CONTENT_SUPPRESSING_SHORT_FLAGS = new Set([
  'l', // --files-with-matches (filename only)
  'L', // --files-without-match (filename only)
  'c', // --count (count only)
  'q', // --quiet / --silent (no output)
  'o', // --only-matching (matched substring only — too little context to edit)
  'V', // --version (no file content)
])

// Long flags safe to accept — not content-suppressing, not value-taking.
const SAFE_LONG_FLAGS = new Set([
  '--ignore-case',
  '--line-number',
  '--invert-match',
  '--word-regexp',
  '--line-regexp',
  '--extended-regexp',
  '--fixed-strings',
  '--basic-regexp',
  '--no-filename',
  '--with-filename',
  '--byte-offset',
  '--null',
])

/** Parse a single-file grep command — returns the file path or null. */
export function parseSingleFileGrepCommand(command: string): string | null {
  const trimmed = command.trim()
  // Cheap pre-filter so non-grep commands don't pay for tokenization.
  if (!/^(grep|egrep|fgrep)\s/.test(trimmed)) return null

  const parseResult = tryParseShellCommand(trimmed)
  if (!parseResult.success) return null

  // Reject anything with operators, pipes, redirects, globs, substitutions —
  // any non-string token means it isn't a plain `grep ... file`.
  const args: string[] = []
  for (const token of parseResult.tokens) {
    if (typeof token === 'string') {
      args.push(token)
    } else {
      return null
    }
  }

  if (args.length === 0 || !GREP_COMMANDS.has(args[0]!)) return null

  const positionals: string[] = []
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      // Everything after `--` is positional.
      for (let j = i + 1; j < args.length; j++) positionals.push(args[j]!)
      break
    }
    if (arg.startsWith('--')) {
      const name = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg
      // Value-taking long flags (anything with `=`, or not in the safe set)
      // make operand counting unreliable or suppress content — bail out.
      if (arg.includes('=') || !SAFE_LONG_FLAGS.has(name)) return null
      continue
    }
    if (arg.startsWith('-') && arg.length > 1) {
      // Short-flag cluster, e.g. -in. Bail if any letter is operand-ambiguous
      // or content-suppressing.
      for (const ch of arg.slice(1)) {
        if (
          OPERAND_AMBIGUOUS_SHORT_FLAGS.has(ch) ||
          CONTENT_SUPPRESSING_SHORT_FLAGS.has(ch)
        ) {
          return null
        }
      }
      continue
    }
    positionals.push(arg)
  }

  // Exactly [PATTERN, FILE]. One positional = reading stdin (no file);
  // three+ = multiple files. Both fall outside "single-file grep".
  if (positionals.length !== 2) return null

  const fileOperand = positionals[1]!
  if (fileOperand === '-') return null

  return fileOperand
}
