import { afterEach, describe, expect, test } from 'bun:test'
import {
  getLoginStartingMessage,
  getLoginSuccessMessage,
  isEnvOAuthTokenSet,
} from '../../../commands/login/envTokenWarning.js'

const TOUCHED = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_SIMPLE',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
]

afterEach(() => {
  for (const key of TOUCHED) delete process.env[key]
})

describe('getLoginStartingMessage', () => {
  test('is silent when no override is in the environment', () => {
    expect(getLoginStartingMessage()).toBeUndefined()
  })

  test('warns that the env token keeps winning, and how to clear it', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat-test'
    const message = getLoginStartingMessage()
    expect(message).toContain('CLAUDE_CODE_OAUTH_TOKEN is set in your environment')
    expect(message).toContain('keep overriding')
    expect(message).toContain('unset it')
  })

  test('stays silent in bare mode, where the env token is not consulted', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat-test'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    expect(getLoginStartingMessage()).toBeUndefined()
  })

  test.each([
    ['CLAUDE_CODE_USE_BEDROCK'],
    ['CLAUDE_CODE_USE_VERTEX'],
    ['CLAUDE_CODE_USE_FOUNDRY'],
    ['CLAUDE_CODE_USE_OPENAI'],
  ])('stays silent under %s, which authenticates by its own mechanism', envKey => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat-test'
    process.env[envKey] = '1'
    expect(getLoginStartingMessage()).toBeUndefined()
  })
})

describe('getLoginSuccessMessage', () => {
  test('is a bare success when there was no override', () => {
    expect(getLoginSuccessMessage(false)).toBe('Login successful')
  })

  test('repeats the override warning after a successful login', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat-test'
    const message = getLoginSuccessMessage(true)
    expect(message).toStartWith('Login successful')
    expect(message).toContain('CLAUDE_CODE_OAUTH_TOKEN was set in your environment when /login started')
    expect(message).toContain('this session will keep using it')
    expect(message).toContain('Unset it')
  })

  // The regression this two-phase split exists for: /login runs
  // applyActiveProviderProfileEnv(), which deletes the provider env vars, so a
  // session that opened on a third-party provider is on firstParty by the time
  // this message is built — and the env token now decides the auth header.
  // Evaluating the provider up front would go silent here.
  test('fires for a session that started on a third-party provider', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat-test'
    // Entry: the third-party profile is still active, so no warning is due.
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    expect(getLoginStartingMessage()).toBeUndefined()
    const envTokenWasSet = isEnvOAuthTokenSet()
    expect(envTokenWasSet).toBe(true)

    // Completion: applyActiveProviderProfileEnv() has dropped the flag.
    delete process.env.CLAUDE_CODE_USE_OPENAI
    expect(getLoginSuccessMessage(envTokenWasSet)).toContain('CLAUDE_CODE_OAUTH_TOKEN')
  })

  test('stays quiet when the override no longer applies at completion', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat-test'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    expect(getLoginSuccessMessage(true)).toBe('Login successful')
  })

  // Both halves of the note must hold. Either one alone would make it assert
  // something false, so either one missing means a bare success message.
  test('needs both the entry snapshot and the completion re-check', () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    expect(getLoginSuccessMessage(true)).toBe('Login successful')

    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat-test'
    expect(getLoginSuccessMessage(false)).toBe('Login successful')
  })
})
