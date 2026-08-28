import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getModelMaxOutputTokens } from '../../utils/context.js'

const originalUserType = process.env.USER_TYPE

beforeEach(() => {
  delete process.env.USER_TYPE
})

afterEach(() => {
  if (originalUserType === undefined) delete process.env.USER_TYPE
  else process.env.USER_TYPE = originalUserType
})

/**
 * Pinned against upstream's baked model catalog, whose per-model
 * `max_output_tokens:{default,upper}` these two numbers mirror one-for-one.
 */
describe('getModelMaxOutputTokens', () => {
  test('Sonnet 4.6 keeps a 32k default but reaches 128k', () => {
    // The ceiling was previously set to 64k on the reading that only Opus 4.6+
    // reaches 128k; the catalog says {default:32000, upper:128000}.
    expect(getModelMaxOutputTokens('claude-sonnet-4-6')).toEqual({
      default: 32_000,
      upperLimit: 128_000,
    })
  })

  test('Opus 4.6+ / Sonnet 5 / Fable 5 are 64k default, 128k ceiling', () => {
    for (const model of [
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-fable-5',
    ]) {
      expect(getModelMaxOutputTokens(model)).toEqual({
        default: 64_000,
        upperLimit: 128_000,
      })
    }
  })

  test('Opus 4.5 and the Sonnet 4 line stay at 32k/64k', () => {
    expect(getModelMaxOutputTokens('claude-opus-4-5-20251101')).toEqual({
      default: 32_000,
      upperLimit: 64_000,
    })
    expect(getModelMaxOutputTokens('claude-sonnet-4-5-20250929')).toEqual({
      default: 32_000,
      upperLimit: 64_000,
    })
  })

  test('Opus 4 / 4.1 cannot exceed their 32k default', () => {
    expect(getModelMaxOutputTokens('claude-opus-4-1-20250805')).toEqual({
      default: 32_000,
      upperLimit: 32_000,
    })
  })
})
