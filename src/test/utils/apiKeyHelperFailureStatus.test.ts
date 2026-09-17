import { APIError } from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getIsNonInteractiveSession,
  setFlagSettingsInline,
  setIsInteractive,
} from '../../bootstrap/state.js'
import {
  API_KEY_HELPER_FAILING_ERROR_MESSAGE,
  getAssistantMessageFromError,
} from '../../services/api/errors.js'
import {
  clearApiKeyHelperCache,
  getApiKeyFromApiKeyHelper,
  getActiveApiKeyHelperFailure,
} from '../../utils/auth.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { buildAccountProperties } from '../../utils/status.js'

const ENV_KEYS = [
  'CLAUDE_CODE_SIMPLE',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_REMOTE',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_BASE_URL',
  'IS_DEMO',
] as const
const originalNonInteractive = getIsNonInteractiveSession()
const original = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

function useHelper(command: string) {
  setFlagSettingsInline({ apiKeyHelper: command })
  resetSettingsCache()
  clearApiKeyHelperCache()
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  // --bare reads apiKeyHelper only from flag settings, keeping the machine's
  // own settings files out of the test.
  process.env.CLAUDE_CODE_SIMPLE = '1'
  setIsInteractive(true)
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  setIsInteractive(!originalNonInteractive)
  setFlagSettingsInline(null)
  resetSettingsCache()
  clearApiKeyHelperCache()
})

function helperRow() {
  return buildAccountProperties().find(p => p.label === 'apiKeyHelper')
}

describe('apiKeyHelper failure surfaces in /status', () => {
  test('shows the failing script output after a failed run', async () => {
    useHelper("printf 'token expired\\n\\033[31mrun sso login\\033[0m' >&2; exit 3")
    expect(await getApiKeyFromApiKeyHelper(true)).toBe(' ')

    expect(getActiveApiKeyHelperFailure()).toBe(
      'exited 3: token expired run sso login',
    )
    expect(helperRow()?.value).toBe(
      'Failing — last run exited 3: token expired run sso login',
    )
  })

  test('the failure outlives the 401-retry cache clear', async () => {
    useHelper('echo boom >&2; exit 1')
    await getApiKeyFromApiKeyHelper(true)
    clearApiKeyHelperCache()

    expect(helperRow()?.value).toBe('Failing — last run exited 1: boom')
  })

  test('a successful run clears the failure', async () => {
    useHelper('exit 1')
    await getApiKeyFromApiKeyHelper(true)
    expect(getActiveApiKeyHelperFailure()).not.toBeNull()

    useHelper('echo sk-good')
    expect(await getApiKeyFromApiKeyHelper(true)).toBe('sk-good')
    expect(getActiveApiKeyHelperFailure()).toBeNull()
    expect(helperRow()).toBeUndefined()
  })

  test('hides the detail in demo mode', async () => {
    useHelper('echo secret-path >&2; exit 2')
    await getApiKeyFromApiKeyHelper(true)
    process.env.IS_DEMO = '1'

    expect(helperRow()?.value).toBe('Failing')
  })

  test('the 401 banner points at /status only while the helper is failing', async () => {
    const unauthorized = new APIError(
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      'invalid x-api-key',
      new Headers(),
    )

    useHelper('echo sk-good')
    await getApiKeyFromApiKeyHelper(true)
    expect(JSON.stringify(getAssistantMessageFromError(unauthorized, 'claude-opus-5'))).not.toContain('/status')

    useHelper('exit 1')
    await getApiKeyFromApiKeyHelper(true)
    const message = getAssistantMessageFromError(unauthorized, 'claude-opus-5')
    expect(JSON.stringify(message)).toContain(API_KEY_HELPER_FAILING_ERROR_MESSAGE)
  })

  test('--print inlines the script error since /status is unavailable', async () => {
    const unauthorized = new APIError(
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      'invalid x-api-key',
      new Headers(),
    )
    useHelper('echo sso expired >&2; exit 4')
    await getApiKeyFromApiKeyHelper(true)
    setIsInteractive(false)

    const text = JSON.stringify(getAssistantMessageFromError(unauthorized, 'claude-opus-5'))
    expect(text).toContain('Last run exited 4: sso expired')
    expect(text).not.toContain('/status')
  })
})
