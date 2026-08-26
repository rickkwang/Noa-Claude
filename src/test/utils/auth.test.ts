import { afterEach, describe, expect, test } from 'bun:test'
import {
  getAnthropicApiKeyWithSource,
  getAuthTokenSource,
  isAnthropicAuthEnabled,
} from '../../utils/auth.js'
import { isDirectFirstParty } from '../../utils/model/providers.js'

const ENV_KEYS = [
  'CLAUDE_CODE_SIMPLE',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_BEDROCK',
  'ANTHROPIC_BASE_URL',
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

describe('isAnthropicAuthEnabled routes away from 1P auth', () => {
  test('an OpenAI-compatible route is not a first-party auth route', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'

    // isClaudeAISubscriber() is derived from this. Leaving it true on an
    // OpenAI route made the session claim a claude.ai subscription: an
    // oauth beta header on the request, subscription billing in /status,
    // and a token refresh for a credential the request never uses.
    expect(isAnthropicAuthEnabled()).toBe(false)
  })

  test('still covers the env-flag providers and custom base URLs', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(isAnthropicAuthEnabled()).toBe(false)
    delete process.env.CLAUDE_CODE_USE_BEDROCK

    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    expect(isAnthropicAuthEnabled()).toBe(false)
  })
})

describe('getAuthTokenSource on a provider-profile route', () => {
  test('claims no Anthropic token when routed through the OpenAI shim', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'

    // A leftover claude.ai token in the keychain is not this session's auth
    // source; reporting it made `auth status` print authMethod=claude.ai
    // alongside apiProvider=openaiCompatible.
    expect(getAuthTokenSource()).toEqual({
      source: 'none',
      hasToken: false,
    })
  })
})

describe('authStatus third-party classification', () => {
  test('a Bearer token for an Anthropic-compatible endpoint is not OAuth', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    process.env.ANTHROPIC_AUTH_TOKEN = 'sk-third-party-bearer'

    // getAuthTokenSource reports ANTHROPIC_AUTH_TOKEN, which authStatus's
    // ladder used to fall through to authMethod 'oauth_token'. It is a
    // third-party API token; only !isDirectFirstParty() separates the two.
    expect(getAuthTokenSource().source).toBe('ANTHROPIC_AUTH_TOKEN')
    expect(isDirectFirstParty()).toBe(false)
  })
})
