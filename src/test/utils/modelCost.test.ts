import { afterEach, describe, expect, test } from 'bun:test'
import {
  COST_TIER_2_10,
  COST_TIER_10_50,
  COST_TIER_30_150,
  COST_TIER_3_15,
  COST_TIER_5_25,
  getModelCosts,
  getModelPricingString,
  getOpusCostTierForModel,
  getSonnet5CostTier,
} from '../../utils/modelCost.js'
import { getSonnet5_1MOption } from '../../utils/model/modelOptions.js'

const originalBaseUrl = process.env.ANTHROPIC_BASE_URL
const originalDisableFastMode = process.env.CLAUDE_CODE_DISABLE_FAST_MODE

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = originalBaseUrl
  if (originalDisableFastMode === undefined)
    delete process.env.CLAUDE_CODE_DISABLE_FAST_MODE
  else process.env.CLAUDE_CODE_DISABLE_FAST_MODE = originalDisableFastMode
})

describe('Opus 5 pricing', () => {
  test('fast mode charges $10/$50, not the $30/$150 of Opus 4.6/4.7', () => {
    delete process.env.CLAUDE_CODE_DISABLE_FAST_MODE

    expect(getOpusCostTierForModel('claude-opus-5', true)).toBe(COST_TIER_10_50)
    expect(getOpusCostTierForModel('claude-opus-4-8', true)).toBe(
      COST_TIER_30_150,
    )
  })

  test('standard mode is $5/$25 across the Opus generations', () => {
    expect(getOpusCostTierForModel('claude-opus-5', false)).toBe(COST_TIER_5_25)
    expect(getOpusCostTierForModel('claude-opus-4-8', false)).toBe(
      COST_TIER_5_25,
    )
  })

  test('disabling fast mode drops the fast-mode surcharge entirely', () => {
    process.env.CLAUDE_CODE_DISABLE_FAST_MODE = '1'

    expect(getOpusCostTierForModel('claude-opus-5', true)).toBe(COST_TIER_5_25)
  })

  test('routes on the canonical name, so [1m] and provider IDs still price as Opus 5', () => {
    delete process.env.CLAUDE_CODE_DISABLE_FAST_MODE

    expect(getOpusCostTierForModel('claude-opus-5[1m]', true)).toBe(
      COST_TIER_10_50,
    )
    expect(getOpusCostTierForModel('us.anthropic.claude-opus-5', true)).toBe(
      COST_TIER_10_50,
    )
  })

  test('getModelCosts applies the Opus 5 fast tier from usage.speed', () => {
    delete process.env.CLAUDE_CODE_DISABLE_FAST_MODE
    const fast = { speed: 'fast' } as never
    const standard = {} as never

    expect(getModelCosts('claude-opus-5', fast)).toBe(COST_TIER_10_50)
    expect(getModelCosts('claude-opus-5', standard)).toBe(COST_TIER_5_25)
  })
})

describe('Sonnet 5 pricing', () => {
  // $2/$10 is Sonnet 5's standing rate, not a promotion: upstream's baked model
  // catalog maps claude-sonnet-5 to a plain `tier_2_10` entry with no expiry,
  // and the upstream bundle has no date-gated pricing path. A previous reading
  // of it as introductory put a 2026-09-01 cliff back to $3/$15 here; these
  // tests pin the absence of any such cliff.
  test('uses the $2/$10 tier regardless of date', () => {
    expect(getSonnet5CostTier()).toBe(COST_TIER_2_10)
    expect(getModelPricingString('claude-sonnet-5')).toBe('$2/$10 per Mtok')
  })

  test('does not revert to the $3/$15 Sonnet tier over time', () => {
    expect(getSonnet5CostTier()).not.toBe(COST_TIER_3_15)
  })

  test('does not apply or display first-party Sonnet 5 pricing on custom endpoints', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.test'
    const usage = { input_tokens: 1, output_tokens: 1 } as never

    expect(getModelCosts('claude-sonnet-5', usage)).toBe(COST_TIER_3_15)
    expect(getSonnet5_1MOption().description).not.toContain('$')
  })
})
