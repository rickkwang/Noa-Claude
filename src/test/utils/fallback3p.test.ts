import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getModelFallbackSuggestionForTesting } from '../../utils/model/validateModel.js'

const SAVED = { ...process.env }

beforeEach(() => {
  process.env.CLAUDE_CODE_USE_BEDROCK = '1'
  delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
})

afterEach(() => {
  process.env = { ...SAVED }
})

/**
 * Mirrors the `fallback_3p` column of upstream's baked catalog (2.1.258).
 * These feed the "Model 'X' not found. Try 'Y' instead" suggestion — upstream
 * does not auto-retry on an unavailable third-party model either, so this
 * chain is the whole recovery story on both sides.
 */
describe('third-party fallback suggestions match the upstream catalog', () => {
  const CHAIN: [string, string][] = [
    ['claude-fable-5-1', 'claude-fable-5'],
    ['claude-fable-5', 'claude-opus-5'],
    ['claude-opus-5', 'claude-opus-4-8'],
    ['claude-opus-4-8', 'claude-opus-4-7'],
    ['claude-opus-4-7', 'claude-opus-4-6'],
    ['claude-opus-4-6', 'claude-opus-4-5'],
    ['claude-opus-4-5', 'claude-opus-4-1'],
    ['claude-sonnet-5', 'claude-sonnet-4-6'],
    ['claude-sonnet-4-6', 'claude-sonnet-4-5'],
  ]

  for (const [from, to] of CHAIN) {
    test(`${from} suggests ${to}`, () => {
      expect(getModelFallbackSuggestionForTesting(from)).toContain(to)
    })
  }

  test('a fable→opus fallback prefers an explicitly pinned opus model', () => {
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'my-opus-deployment'
    expect(getModelFallbackSuggestionForTesting('claude-fable-5')).toBe(
      'my-opus-deployment',
    )
    // fable 5.1 falls back within the fable family, so the pin does not apply
    expect(getModelFallbackSuggestionForTesting('claude-fable-5-1')).toContain(
      'claude-fable-5',
    )
  })

  test('no suggestion on first party', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    expect(getModelFallbackSuggestionForTesting('claude-opus-5')).toBeUndefined()
  })
})
