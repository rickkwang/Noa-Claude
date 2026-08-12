import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test'

const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY',
  'NOA_CLAUDE_WRITE_REQUIRE_READ',
] as const
const originalProviderEnv = Object.fromEntries(
  PROVIDER_ENV_KEYS.map(k => [k, process.env[k]]),
)
beforeEach(() => {
  for (const k of PROVIDER_ENV_KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of PROVIDER_ENV_KEYS) {
    const value = originalProviderEnv[k]
    if (value === undefined) delete process.env[k]
    else process.env[k] = value
  }
})

import { allowsWriteWithoutPriorRead } from '../../constants/systemPromptCompact.js'

describe('allowsWriteWithoutPriorRead', () => {
  // Every entry, because the set is matched against getCanonicalName output
  // while upstream matches raw ids — a name that canonicalizes differently
  // silently never matches.
  test.each([
    'claude-opus-4-6',
    'claude-haiku-4-5',
    'claude-opus-4-5',
    'claude-opus-4-1',
    'claude-opus-4-0',
    'claude-sonnet-4-5',
    'claude-sonnet-4-0',
    'claude-3-7-sonnet',
    'claude-3-5-sonnet',
    'claude-3-5-haiku',
  ])('%s is on upstream 2.1.228 denylist and keeps the guard', model => {
    expect(allowsWriteWithoutPriorRead(model)).toBe(false)
  })

  test('newer models may overwrite an unread file', () => {
    expect(allowsWriteWithoutPriorRead('claude-opus-5')).toBe(true)
    expect(allowsWriteWithoutPriorRead('claude-sonnet-5')).toBe(true)
    expect(allowsWriteWithoutPriorRead('claude-opus-4-7')).toBe(true)
  })

  test('long-context suffixes resolve to the base model', () => {
    expect(allowsWriteWithoutPriorRead('claude-sonnet-4-5[1m]')).toBe(false)
  })

  test('an absent model is treated conservatively', () => {
    expect(allowsWriteWithoutPriorRead(undefined)).toBe(false)
  })

  test('untrusted model identities keep the guard', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(allowsWriteWithoutPriorRead('claude-opus-5')).toBe(false)
  })

  test('operators can opt back into upstream model-name trust', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY = 'upstream'
    expect(allowsWriteWithoutPriorRead('claude-opus-5')).toBe(true)
  })

  test('NOA_CLAUDE_WRITE_REQUIRE_READ forces either mode', () => {
    process.env.NOA_CLAUDE_WRITE_REQUIRE_READ = '1'
    expect(allowsWriteWithoutPriorRead('claude-opus-5')).toBe(false)

    process.env.NOA_CLAUDE_WRITE_REQUIRE_READ = '0'
    expect(allowsWriteWithoutPriorRead('claude-sonnet-4-5')).toBe(true)
  })
})
