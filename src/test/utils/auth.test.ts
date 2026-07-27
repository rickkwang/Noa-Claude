import { afterEach, describe, expect, test } from 'bun:test'
import { getAuthTokenSource } from '../../utils/auth.js'

const ENV_KEYS = ['CLAUDE_CODE_SIMPLE', 'ANTHROPIC_AUTH_TOKEN'] as const
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
