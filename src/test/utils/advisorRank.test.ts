import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  isValidAdvisorModel,
  isValidAdvisorPairing,
  modelSupportsAdvisor,
} from '../../utils/advisor.js'

const originalUserType = process.env.USER_TYPE

beforeEach(() => {
  delete process.env.USER_TYPE
})

afterEach(() => {
  if (originalUserType === undefined) delete process.env.USER_TYPE
  else process.env.USER_TYPE = originalUserType
})

/**
 * Ranks mirror upstream's `advisor_rank` column. The previous implementation
 * was a two-entry allowlist frozen at the 4.6 generation, which made advisor
 * unavailable on every model shipped since and never checked the pair at all.
 */
describe('modelSupportsAdvisor', () => {
  test('ranked models can have an advisor attached', () => {
    for (const model of [
      'claude-haiku-4-5',
      'claude-sonnet-4-6',
      'claude-sonnet-5',
      'claude-opus-4-6',
      'claude-opus-4-8',
      'claude-opus-5',
      'claude-fable-5',
    ]) {
      expect(modelSupportsAdvisor(model)).toBe(true)
    }
  })

  test('unranked older models cannot', () => {
    for (const model of [
      'claude-opus-4-5-20251101',
      'claude-opus-4-1-20250805',
      'claude-sonnet-4-5-20250929',
      'claude-3-5-haiku-20241022',
    ]) {
      expect(modelSupportsAdvisor(model)).toBe(false)
    }
  })
})

describe('isValidAdvisorModel', () => {
  test('rank >= 2 may serve as an advisor', () => {
    expect(isValidAdvisorModel('claude-sonnet-4-6')).toBe(true)
    expect(isValidAdvisorModel('claude-opus-5')).toBe(true)
    expect(isValidAdvisorModel('claude-fable-5')).toBe(true)
  })

  test('Haiku 4.5 ranks too low to advise anyone', () => {
    expect(modelSupportsAdvisor('claude-haiku-4-5')).toBe(true)
    expect(isValidAdvisorModel('claude-haiku-4-5')).toBe(false)
  })

  test('unranked models may not advise', () => {
    expect(isValidAdvisorModel('claude-opus-4-5-20251101')).toBe(false)
  })
})

describe('isValidAdvisorPairing', () => {
  test('an advisor at or above the base rank is accepted', () => {
    expect(isValidAdvisorPairing('claude-sonnet-5', 'claude-opus-4-8')).toBe(
      true,
    )
    expect(isValidAdvisorPairing('claude-sonnet-5', 'claude-opus-4-7')).toBe(
      true,
    )
    expect(isValidAdvisorPairing('claude-opus-5', 'claude-opus-4-8')).toBe(true)
    expect(isValidAdvisorPairing('claude-opus-5', 'claude-fable-5')).toBe(true)
  })

  test('an advisor below the base rank is rejected', () => {
    expect(isValidAdvisorPairing('claude-opus-5', 'claude-sonnet-4-6')).toBe(
      false,
    )
    expect(isValidAdvisorPairing('claude-fable-5', 'claude-opus-5')).toBe(false)
    expect(isValidAdvisorPairing('claude-sonnet-5', 'claude-sonnet-4-6')).toBe(
      false,
    )
  })

  test('equal ranks pair with each other', () => {
    expect(isValidAdvisorPairing('claude-opus-4-6', 'claude-sonnet-5')).toBe(
      true,
    )
    expect(isValidAdvisorPairing('claude-opus-4-7', 'claude-opus-5')).toBe(true)
  })

  test('an unranked model on either side is not blocked here', () => {
    expect(isValidAdvisorPairing('claude-opus-4-5-20251101', 'claude-opus-5')).toBe(
      true,
    )
    expect(isValidAdvisorPairing('claude-opus-5', 'some-proxy-model')).toBe(true)
  })

  test('ant builds bypass the rank checks on both sides', () => {
    process.env.USER_TYPE = 'ant'
    // A full bypass, not a synthetic rank: Haiku 4.5 ranks below
    // MIN_ADVISOR_RANK, so a rank-based fallback would still reject it.
    expect(isValidAdvisorModel('claude-haiku-4-5')).toBe(true)
    expect(modelSupportsAdvisor('some-unreleased-model')).toBe(true)
    expect(isValidAdvisorPairing('claude-fable-5', 'claude-haiku-4-5')).toBe(
      true,
    )
  })

  test('resolves through provider-prefixed ids', () => {
    expect(
      isValidAdvisorPairing(
        'us.anthropic.claude-opus-5',
        'us.anthropic.claude-sonnet-4-6',
      ),
    ).toBe(false)
    expect(modelSupportsAdvisor('us.anthropic.claude-opus-5')).toBe(true)
  })
})
