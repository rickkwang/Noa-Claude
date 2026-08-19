import { afterEach, describe, expect, test } from 'bun:test'
import {
  getAnthropicApiKeyWithSource,
  getAuthTokenSource,
} from '../../utils/auth.js'

const ENV_KEYS = [
  'CLAUDE_CODE_SIMPLE',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CI',
] as const
const original = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('getAuthTokenSource under --bare', () => {
  test('reports a caller-supplied Bearer token', () => {
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.ANTHROPIC_AUTH_TOKEN = 'sk-caller-bearer'

    // --bare treats the caller's env as the whole auth contract, and
    // getAnthropicClient authenticates 3P providers straight off
    // ANTHROPIC_AUTH_TOKEN. Reporting 'none' here makes `auth status` say
    // logged out for a session whose requests succeed.
    expect(getAuthTokenSource()).toEqual({
      source: 'ANTHROPIC_AUTH_TOKEN',
      hasToken: true,
    })
  })

  test('does not invent a Bearer source when the caller set none', () => {
    process.env.CLAUDE_CODE_SIMPLE = '1'
    delete process.env.ANTHROPIC_AUTH_TOKEN

    // Asserted as "not ANTHROPIC_AUTH_TOKEN" rather than 'none': a machine
    // with an apiKeyHelper in user settings legitimately reports that source.
    expect(getAuthTokenSource().source).not.toBe('ANTHROPIC_AUTH_TOKEN')
  })
})

describe('getAnthropicApiKeyWithSource in CI', () => {
  function clearCredentials() {
    process.env.CI = '1'
    delete process.env.CLAUDE_CODE_SIMPLE
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
  }

  test('accepts a Bearer token as the sole credential', () => {
    clearCredentials()
    process.env.ANTHROPIC_AUTH_TOKEN = 'sk-caller-bearer'

    // ANTHROPIC_AUTH_TOKEN is how Anthropic-compatible third parties
    // authenticate, and getAnthropicClient reads it straight off process.env.
    // Throwing here failed every such CI run before its first request.
    // 'none' (not the token) is correct: this function returns API keys only.
    expect(getAnthropicApiKeyWithSource()).toEqual({
      key: null,
      source: 'none',
    })
  })

  test('still requires some credential', () => {
    clearCredentials()

    expect(() => getAnthropicApiKeyWithSource()).toThrow(
      /ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or CLAUDE_CODE_OAUTH_TOKEN/,
    )
  })

  test('an API key still wins over a Bearer token', () => {
    clearCredentials()
    process.env.ANTHROPIC_API_KEY = 'sk-api-key'
    process.env.ANTHROPIC_AUTH_TOKEN = 'sk-caller-bearer'

    expect(getAnthropicApiKeyWithSource()).toEqual({
      key: 'sk-api-key',
      source: 'ANTHROPIC_API_KEY',
    })
  })
})
