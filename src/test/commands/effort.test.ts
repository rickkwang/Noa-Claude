import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { showCurrentEffort } from '../../commands/effort/effort.js'

const ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_VERTEX',
  'USER_TYPE',
] as const

const originalEnv = new Map<string, string | undefined>()

function resetEnv(): void {
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key)
    if (original === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = original
    }
  }
}

describe('/effort current', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    resetEnv()
  })

  test('shows the effective clamped effort for the current model', () => {
    expect(showCurrentEffort('xhigh', 'claude-opus-4-6').message).toContain(
      'Current effort level: high (configured xhigh)',
    )
  })

  test('shows unsupported effort as not applied for unsupported models', () => {
    expect(showCurrentEffort('low', 'claude-haiku-4-5').message).toBe(
      'Current effort level: low (not supported by current model/provider)',
    )
  })

  test('shows unsupported status for unsupported models without configured effort', () => {
    expect(showCurrentEffort(undefined, 'claude-haiku-4-5').message).toBe(
      'Effort is not supported for current model/provider (claude-haiku-4-5)',
    )
  })
})
