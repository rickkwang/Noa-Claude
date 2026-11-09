import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  CLAUDE_CODE_COMPAT_VERSION,
  getApiClientVersion,
  negotiateApiClientVersion,
  resetNegotiatedApiClientVersion,
} from '../../constants/apiClientVersion.js'
import { getUserAgent } from '../../utils/http.js'

const original = process.env.NOA_CLAUDE_API_CLIENT_VERSION
beforeEach(() => {
  delete process.env.NOA_CLAUDE_API_CLIENT_VERSION
})
afterEach(() => {
  resetNegotiatedApiClientVersion()
  if (original === undefined) delete process.env.NOA_CLAUDE_API_CLIENT_VERSION
  else process.env.NOA_CLAUDE_API_CLIENT_VERSION = original
})

const rank = (version: string): number => {
  const parts = version.split('.').map(Number)
  expect(parts).toHaveLength(3)
  expect(parts.every(Number.isInteger)).toBe(true)
  return parts.reduce((acc, part) => acc * 1e4 + part, 0)
}

describe('the version Noa reports to the Anthropic API', () => {
  // The API withholds models from clients that predate them. Reporting the
  // fork's own version answers the wrong question and loses the user working
  // models: Fable 5.1 returns `claude_code_version_too_old` below 2.1.251.
  test('is the compatibility baseline, not the fork version', () => {
    expect(getApiClientVersion()).toBe(CLAUDE_CODE_COMPAT_VERSION)
    expect(getUserAgent()).toContain(`claude-cli/${CLAUDE_CODE_COMPAT_VERSION}`)
    expect(getUserAgent()).not.toContain('claude-cli/1.12.0')
  })

  test('clears the gate that rejected Fable 5.1', () => {
    // `version 2.1.251 or newer is required`
    expect(rank(CLAUDE_CODE_COMPAT_VERSION)).toBeGreaterThanOrEqual(
      rank('2.1.251'),
    )
  })

  test('clears the gate that rejected Opus 5.5', () => {
    // `Claude Code 2.1.258 does not support this model; version 2.1.280 or
    // newer is required` — Opus 5.5 is the default for most tiers.
    expect(rank(CLAUDE_CODE_COMPAT_VERSION)).toBeGreaterThanOrEqual(
      rank('2.1.280'),
    )
  })

  test('clears the gate that rejected Fable 5.2', () => {
    // `Claude Code 2.1.280 does not support this model; version 2.1.290 or
    // newer is required`
    expect(rank(CLAUDE_CODE_COMPAT_VERSION)).toBeGreaterThanOrEqual(
      rank('2.1.290'),
    )
  })

  test('honours the override, ignoring blank values', () => {
    process.env.NOA_CLAUDE_API_CLIENT_VERSION = '2.1.251'
    expect(getApiClientVersion()).toBe('2.1.251')
    expect(getUserAgent()).toContain('claude-cli/2.1.251')

    process.env.NOA_CLAUDE_API_CLIENT_VERSION = '   '
    expect(getApiClientVersion()).toBe(CLAUDE_CODE_COMPAT_VERSION)
  })

  test('raises to the version the API names, once', () => {
    const message =
      "Claude Code 2.1.290 does not support this model; version 9.9.9 or newer is required. Run 'claude update'"
    expect(negotiateApiClientVersion(message)).toBe(true)
    expect(getApiClientVersion()).toBe('9.9.9')
    expect(getUserAgent()).toContain('claude-cli/9.9.9')
    // Naming a version we already report changes nothing, so a retry cannot loop.
    expect(negotiateApiClientVersion(message)).toBe(false)
    expect(negotiateApiClientVersion('unrelated 400')).toBe(false)
  })
})
