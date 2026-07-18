import { afterEach, describe, expect, test } from 'bun:test'
import {
  COST_SONNET_5_INTRO_2_10,
  COST_TIER_3_15,
  getModelCosts,
  getModelPricingString,
  getSonnet5CostTier,
} from '../../utils/modelCost.js'
import { getSonnet5_1MOption } from '../../utils/model/modelOptions.js'

const originalBaseUrl = process.env.ANTHROPIC_BASE_URL

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = originalBaseUrl
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
