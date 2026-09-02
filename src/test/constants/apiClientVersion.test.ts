import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  CLAUDE_CODE_COMPAT_VERSION,
  getApiClientVersion,
} from '../../constants/apiClientVersion.js'
import { getUserAgent } from '../../utils/http.js'

const original = process.env.NOA_CLAUDE_API_CLIENT_VERSION
beforeEach(() => {
  delete process.env.NOA_CLAUDE_API_CLIENT_VERSION
})
afterEach(() => {
  if (original === undefined) delete process.env.NOA_CLAUDE_API_CLIENT_VERSION
  else process.env.NOA_CLAUDE_API_CLIENT_VERSION = original
})

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
    const rank = (version: string): number => {
      const parts = version.split('.').map(Number)
      expect(parts).toHaveLength(3)
      expect(parts.every(Number.isInteger)).toBe(true)
      return parts.reduce((acc, part) => acc * 1e4 + part, 0)
    }
    // `version 2.1.251 or newer is required`
    expect(rank(CLAUDE_CODE_COMPAT_VERSION)).toBeGreaterThanOrEqual(
      rank('2.1.251'),
    )
  })

  test('honours the override, ignoring blank values', () => {
    process.env.NOA_CLAUDE_API_CLIENT_VERSION = '2.1.251'
    expect(getApiClientVersion()).toBe('2.1.251')
    expect(getUserAgent()).toContain('claude-cli/2.1.251')

    process.env.NOA_CLAUDE_API_CLIENT_VERSION = '   '
    expect(getApiClientVersion()).toBe(CLAUDE_CODE_COMPAT_VERSION)
  })
})
