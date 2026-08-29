import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { configureEffortParams } from '../../../services/api/claude.js'

const ENV_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'ANTHROPIC_BASE_URL',
  'USER_TYPE',
] as const

const original = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

// Provider detection reads ambient env (e.g. a developer's ANTHROPIC_BASE_URL
// pointing at a third-party endpoint), which flips effort support off and
// breaks these tests. Pin a clean first-party environment per test.
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})

/**
 * `outputConfig` is seeded from CLAUDE_CODE_EXTRA_BODY's `output_config`, so it
 * can arrive carrying an `effort` the user set for some other model. Sending
 * that to a model without the effort parameter is a hard 400 that fails the
 * whole request, so it has to be stripped rather than skipped over.
 */
describe('configureEffortParams', () => {
  test('strips a carried-over effort when the model has no effort parameter', () => {
    const outputConfig: Record<string, unknown> = { effort: 'xhigh' }
    configureEffortParams(
      undefined,
      outputConfig as never,
      {},
      [],
      'claude-3-5-haiku-20241022',
    )
    expect(outputConfig).toEqual({})
  })

  test('leaves an explicitly supplied effort alone on a supporting model', () => {
    const outputConfig: Record<string, unknown> = { effort: 'xhigh' }
    configureEffortParams(undefined, outputConfig as never, {}, [], 'claude-opus-5')
    expect(outputConfig).toEqual({ effort: 'xhigh' })
  })

  test('applies the resolved effort when none was carried over', () => {
    const outputConfig: Record<string, unknown> = {}
    configureEffortParams('max', outputConfig as never, {}, [], 'claude-opus-5')
    expect(outputConfig).toEqual({ effort: 'max' })
  })

  test('sends nothing when no effort is resolved', () => {
    const outputConfig: Record<string, unknown> = {}
    configureEffortParams(undefined, outputConfig as never, {}, [], 'claude-opus-5')
    expect(outputConfig).toEqual({})
  })
})
