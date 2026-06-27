import { describe, expect, test } from 'bun:test'
import { matchesPattern } from '../../utils/hooks.js'

// Regression: hyphenated identifiers (e.g. `code-reviewer`, `mcp__brave-search`)
// used to fall through to regex and accidentally substring-match. For
// identifier-style events (useExactMatch=true) they must now compare as exact
// strings. Mirrors Claude Code v2.1.195.
describe('matchesPattern — hyphenated identifiers exact-match', () => {
  test('hyphenated agent name matches itself exactly', () => {
    expect(matchesPattern('code-reviewer', 'code-reviewer', true)).toBe(true)
  })

  test('hyphenated name does NOT substring-match a longer query', () => {
    // Before the fix `new RegExp('code-reviewer').test('xcode-reviewerx')` → true.
    expect(matchesPattern('xcode-reviewerx', 'code-reviewer', true)).toBe(false)
  })

  test('bare `mcp__<server>` no longer matches a tool from that server', () => {
    // Before the fix this substring-matched mcp__brave-search__brave_web_search.
    expect(
      matchesPattern(
        'mcp__brave-search__brave_web_search',
        'mcp__brave-search',
        true,
      ),
    ).toBe(false)
  })

  test('the documented `mcp__<server>__.*` regex form matches all its tools', () => {
    expect(
      matchesPattern(
        'mcp__brave-search__brave_web_search',
        'mcp__brave-search__.*',
        true,
      ),
    ).toBe(true)
  })

  test('full hyphenated tool name exact-matches', () => {
    expect(
      matchesPattern(
        'mcp__brave-search__brave_web_search',
        'mcp__brave-search__brave_web_search',
        true,
      ),
    ).toBe(true)
  })

  test('comma-separated lists are supported for identifier events', () => {
    expect(matchesPattern('Edit', 'Write, Edit', true)).toBe(true)
    expect(matchesPattern('Read', 'Write, Edit', true)).toBe(false)
  })

  test('pipe-separated lists still work', () => {
    expect(matchesPattern('Edit', 'Write|Edit', true)).toBe(true)
  })

  test('`*` and empty matcher match everything', () => {
    expect(matchesPattern('anything', '*', true)).toBe(true)
    expect(matchesPattern('anything', '', true)).toBe(true)
  })

  test('genuine regex patterns still work', () => {
    expect(matchesPattern('Write', '^Write.*', true)).toBe(true)
    expect(matchesPattern('Bash', '^(Write|Edit)$', true)).toBe(false)
  })
})

// Non-identifier events (e.g. FileChanged) keep regex semantics: a hyphenated
// matcher is still a regex so it can substring-match a path basename.
describe('matchesPattern — non-exact (regex) events unchanged', () => {
  test('hyphenated matcher substring-matches when useExactMatch=false', () => {
    expect(matchesPattern('my-component.tsx', 'my-component', false)).toBe(true)
  })

  test('plain tool name still exact-matches when useExactMatch=false', () => {
    expect(matchesPattern('Bash', 'Bash', false)).toBe(true)
    expect(matchesPattern('Bashful', 'Bash', false)).toBe(false)
  })
})
