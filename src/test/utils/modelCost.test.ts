import { afterEach, describe, expect, test } from 'bun:test'
import {
  COST_SONNET_5_INTRO_2_10,
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
  test('uses introductory pricing through August 31, 2026', () => {
    const duringIntro = Date.parse('2026-08-31T23:59:59.999Z')

    expect(getSonnet5CostTier(duringIntro)).toBe(COST_SONNET_5_INTRO_2_10)
    expect(getModelPricingString('claude-sonnet-5', duringIntro)).toBe(
      '$2/$10 per Mtok',
    )
  })

  test('switches to standard pricing on September 1, 2026', () => {
    const afterIntro = Date.parse('2026-09-01T00:00:00.000Z')

    expect(getSonnet5CostTier(afterIntro)).toBe(COST_TIER_3_15)
    expect(getModelPricingString('claude-sonnet-5', afterIntro)).toBe(
      '$3/$15 per Mtok',
    )
  })

  test('does not apply or display Anthropic promotional pricing on custom endpoints', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.test'
    const duringIntro = Date.parse('2026-08-31T23:59:59.999Z')
    const usage = { input_tokens: 1, output_tokens: 1 } as never

    expect(getModelCosts('claude-sonnet-5', usage, duringIntro)).toBe(
      COST_TIER_3_15,
    )
    expect(getSonnet5_1MOption().description).not.toContain('$')
  })
})
