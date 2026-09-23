// @ts-nocheck
import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js'
import { logEvent } from 'src/services/analytics/index.js'
import { setHasUnknownModelCost } from '../bootstrap/state.js'
import { isFastModeEnabled } from './fastMode.js'
import {
  CLAUDE_3_5_HAIKU_CONFIG,
  CLAUDE_3_5_V2_SONNET_CONFIG,
  CLAUDE_3_7_SONNET_CONFIG,
  CLAUDE_HAIKU_4_5_CONFIG,
  CLAUDE_OPUS_4_1_CONFIG,
  CLAUDE_OPUS_4_5_CONFIG,
  CLAUDE_OPUS_4_6_CONFIG,
  CLAUDE_OPUS_4_7_CONFIG,
  CLAUDE_OPUS_4_8_CONFIG,
  CLAUDE_OPUS_5_CONFIG,
  CLAUDE_OPUS_5_5_CONFIG,
  CLAUDE_OPUS_4_CONFIG,
  CLAUDE_FABLE_5_1_CONFIG,
  CLAUDE_FABLE_5_CONFIG,
  CLAUDE_SONNET_4_5_CONFIG,
  CLAUDE_SONNET_4_6_CONFIG,
  CLAUDE_SONNET_5_CONFIG,
  CLAUDE_SONNET_4_CONFIG,
} from './model/configs.js'
import {
  firstPartyNameToCanonical,
  getCanonicalName,
  getDefaultMainLoopModelSetting,
  type ModelShortName,
} from './model/model.js'
import { isDirectFirstParty } from './model/providers.js'

// @see https://platform.claude.com/docs/en/about-claude/pricing
export type ModelCosts = {
  inputTokens: number
  outputTokens: number
  /** 5-minute TTL cache writes (1.25x input). */
  promptCacheWriteTokens: number
  /** 1-hour TTL cache writes (2x input). */
  promptCacheWrite1hTokens: number
  promptCacheReadTokens: number
  webSearchRequests: number
}

// Standard pricing tier for Sonnet models: $3 input / $15 output per Mtok
export const COST_TIER_3_15 = {
  inputTokens: 3,
  outputTokens: 15,
  promptCacheWriteTokens: 3.75,
  promptCacheWrite1hTokens: 6,
  promptCacheReadTokens: 0.3,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Pricing tier for Sonnet 5: $2 input / $10 output per Mtok.
//
// This is Sonnet 5's standing rate, NOT a promotion. Upstream's baked model
// catalog maps `claude-sonnet-5` to a plain `tier_2_10` entry with no expiry
// field, and the upstream bundle contains no date-gated pricing path at all.
// An earlier reading of these numbers as introductory added a 2026-09-01 cliff
// back to $3/$15, which would have started over-reporting Sonnet 5 spend by 50%
// in /cost, the stats cache and the model picker. Don't reintroduce it.
export const COST_TIER_2_10 = {
  inputTokens: 2,
  outputTokens: 10,
  promptCacheWriteTokens: 2.5,
  promptCacheWrite1hTokens: 4,
  promptCacheReadTokens: 0.2,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts


// Pricing tier for Opus 4/4.1: $15 input / $75 output per Mtok
export const COST_TIER_15_75 = {
  inputTokens: 15,
  outputTokens: 75,
  promptCacheWriteTokens: 18.75,
  promptCacheWrite1hTokens: 30,
  promptCacheReadTokens: 1.5,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Pricing tier for Opus 4.5: $5 input / $25 output per Mtok
export const COST_TIER_5_25 = {
  inputTokens: 5,
  outputTokens: 25,
  promptCacheWriteTokens: 6.25,
  promptCacheWrite1hTokens: 10,
  promptCacheReadTokens: 0.5,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Fast mode pricing for Opus 4.6/4.7: $30 input / $150 output per Mtok
export const COST_TIER_30_150 = {
  inputTokens: 30,
  outputTokens: 150,
  promptCacheWriteTokens: 37.5,
  promptCacheWrite1hTokens: 60,
  promptCacheReadTokens: 3,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Pricing tier for Fable 5: $10 input / $50 output per Mtok
export const COST_TIER_10_50 = {
  inputTokens: 10,
  outputTokens: 50,
  promptCacheWriteTokens: 12.5,
  promptCacheWrite1hTokens: 20,
  promptCacheReadTokens: 1,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Pricing tier for Fable 5.1: same $10/$50 per Mtok as Fable 5, but cache
// reads are $0.25/Mtok instead of $1.
export const COST_TIER_10_50_CHEAP_CACHE = {
  inputTokens: 10,
  outputTokens: 50,
  promptCacheWriteTokens: 12.5,
  promptCacheWrite1hTokens: 20,
  promptCacheReadTokens: 0.25,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Pricing tier for Opus 5.5: $4 input / $20 output per Mtok, $0.20 cache reads.
export const COST_TIER_4_20 = {
  inputTokens: 4,
  outputTokens: 20,
  promptCacheWriteTokens: 5,
  promptCacheWrite1hTokens: 8,
  promptCacheReadTokens: 0.2,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Fast mode pricing for Opus 5.5: 2x standard, $8 input / $40 output per Mtok.
export const COST_TIER_8_40 = {
  inputTokens: 8,
  outputTokens: 40,
  promptCacheWriteTokens: 10,
  promptCacheWrite1hTokens: 16,
  promptCacheReadTokens: 0.4,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Pricing for Haiku 3.5: $0.80 input / $4 output per Mtok
export const COST_HAIKU_35 = {
  inputTokens: 0.8,
  outputTokens: 4,
  promptCacheWriteTokens: 1,
  promptCacheWrite1hTokens: 1.6,
  promptCacheReadTokens: 0.08,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Pricing for Haiku 4.5: $1 input / $5 output per Mtok
export const COST_HAIKU_45 = {
  inputTokens: 1,
  outputTokens: 5,
  promptCacheWriteTokens: 1.25,
  promptCacheWrite1hTokens: 2,
  promptCacheReadTokens: 0.1,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

const DEFAULT_UNKNOWN_MODEL_COST = COST_TIER_5_25

/**
 * Get the cost tier for Opus 4.6/4.7 based on fast mode.
 */
export function getOpus46CostTier(fastMode: boolean): ModelCosts {
  if (isFastModeEnabled() && fastMode) {
    return COST_TIER_30_150
  }
  return COST_TIER_5_25
}

/**
 * Get the cost tier for Opus 4.8 / Opus 5 based on fast mode. Both price fast
 * mode at $10/$50 per Mtok — not the $30/$150 that Opus 4.6/4.7 charged.
 */
export function getOpus5CostTier(fastMode: boolean): ModelCosts {
  if (isFastModeEnabled() && fastMode) {
    return COST_TIER_10_50
  }
  return COST_TIER_5_25
}

/**
 * Get the cost tier for Opus 5.5 based on fast mode ($8/$40 fast, $4/$20
 * standard).
 */
export function getOpus55CostTier(fastMode: boolean): ModelCosts {
  if (isFastModeEnabled() && fastMode) {
    return COST_TIER_8_40
  }
  return COST_TIER_4_20
}

/**
 * Fast-mode-aware cost tier for whichever Opus generation `model` names.
 * Falls back to the 4.6/4.7 tier for older Opus strings.
 */
export function getOpusCostTierForModel(
  model: string,
  fastMode: boolean,
): ModelCosts {
  const canonical = getCanonicalName(model)
  if (canonical === firstPartyNameToCanonical(CLAUDE_OPUS_5_5_CONFIG.firstParty)) {
    return getOpus55CostTier(fastMode)
  }
  return canonical === firstPartyNameToCanonical(CLAUDE_OPUS_5_CONFIG.firstParty) ||
    canonical === firstPartyNameToCanonical(CLAUDE_OPUS_4_8_CONFIG.firstParty)
    ? getOpus5CostTier(fastMode)
    : getOpus46CostTier(fastMode)
}

// @[MODEL LAUNCH]: Add a pricing entry for the new model below.
// Costs from https://platform.claude.com/docs/en/about-claude/pricing
// Web search cost: $10 per 1000 requests = $0.01 per request
export const MODEL_COSTS: Record<ModelShortName, ModelCosts> = {
  [firstPartyNameToCanonical(CLAUDE_3_5_HAIKU_CONFIG.firstParty)]:
    COST_HAIKU_35,
  [firstPartyNameToCanonical(CLAUDE_HAIKU_4_5_CONFIG.firstParty)]:
    COST_HAIKU_45,
  [firstPartyNameToCanonical(CLAUDE_3_5_V2_SONNET_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_3_7_SONNET_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_SONNET_4_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_SONNET_4_5_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_SONNET_4_6_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_SONNET_5_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_CONFIG.firstParty)]: COST_TIER_15_75,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_1_CONFIG.firstParty)]:
    COST_TIER_15_75,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_5_CONFIG.firstParty)]:
    COST_TIER_5_25,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_6_CONFIG.firstParty)]:
    COST_TIER_5_25,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_7_CONFIG.firstParty)]:
    COST_TIER_5_25,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_8_CONFIG.firstParty)]:
    COST_TIER_5_25,
  [firstPartyNameToCanonical(CLAUDE_OPUS_5_CONFIG.firstParty)]: COST_TIER_5_25,
  [firstPartyNameToCanonical(CLAUDE_OPUS_5_5_CONFIG.firstParty)]: COST_TIER_4_20,
  [firstPartyNameToCanonical(CLAUDE_FABLE_5_CONFIG.firstParty)]: COST_TIER_10_50,
  [firstPartyNameToCanonical(CLAUDE_FABLE_5_1_CONFIG.firstParty)]:
    COST_TIER_10_50_CHEAP_CACHE,
}

/**
 * Calculates the USD cost based on token usage and model cost configuration
 */
function tokensToUSDCost(modelCosts: ModelCosts, usage: Usage): number {
  // 1h-TTL writes are billed at 2x input rather than 1.25x. The split comes
  // from usage.cache_creation; clamp so a malformed breakdown never exceeds
  // the total.
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0
  const cacheWrite1hTokens = Math.min(
    usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    cacheWriteTokens,
  )
  return (
    (usage.input_tokens / 1_000_000) * modelCosts.inputTokens +
    (usage.output_tokens / 1_000_000) * modelCosts.outputTokens +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) *
      modelCosts.promptCacheReadTokens +
    ((cacheWriteTokens - cacheWrite1hTokens) / 1_000_000) *
      modelCosts.promptCacheWriteTokens +
    (cacheWrite1hTokens / 1_000_000) * modelCosts.promptCacheWrite1hTokens +
    (usage.server_tool_use?.web_search_requests ?? 0) *
      modelCosts.webSearchRequests
  )
}

export function getModelCosts(model: string, usage: Usage): ModelCosts {
  const shortName = getCanonicalName(model)

  // Sonnet 5's $2/$10 applies on direct first party only: a proxy or partner
  // endpoint on ANTHROPIC_BASE_URL bills at its own rates, so those fall
  // through to MODEL_COSTS' conservative Sonnet entry.
  if (
    shortName === firstPartyNameToCanonical(CLAUDE_SONNET_5_CONFIG.firstParty) &&
    isDirectFirstParty()
  ) {
    return COST_TIER_2_10
  }

  // Check if this is an Opus 4.6/4.7 model with fast mode active.
  if (
    shortName === firstPartyNameToCanonical(CLAUDE_OPUS_4_6_CONFIG.firstParty) ||
    shortName === firstPartyNameToCanonical(CLAUDE_OPUS_4_7_CONFIG.firstParty)
  ) {
    const isFastMode = usage.speed === 'fast'
    return getOpus46CostTier(isFastMode)
  }

  // Opus 4.8 / Opus 5 fast mode prices at $10/$50, not the $30/$150 of
  // Opus 4.6/4.7.
  if (
    shortName === firstPartyNameToCanonical(CLAUDE_OPUS_5_CONFIG.firstParty) ||
    shortName === firstPartyNameToCanonical(CLAUDE_OPUS_4_8_CONFIG.firstParty)
  ) {
    return getOpus5CostTier(usage.speed === 'fast')
  }

  if (
    shortName === firstPartyNameToCanonical(CLAUDE_OPUS_5_5_CONFIG.firstParty)
  ) {
    return getOpus55CostTier(usage.speed === 'fast')
  }

  const costs = MODEL_COSTS[shortName]
  if (!costs) {
    trackUnknownModelCost(model, shortName)
    return (
      MODEL_COSTS[getCanonicalName(getDefaultMainLoopModelSetting())] ??
      DEFAULT_UNKNOWN_MODEL_COST
    )
  }
  return costs
}

function trackUnknownModelCost(model: string, shortName: ModelShortName): void {
  logEvent('tengu_unknown_model_cost', {
    model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    shortName:
      shortName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  setHasUnknownModelCost()
}

// Calculate the cost of a query in US dollars.
// If the model's costs are not found, use the default model's costs.
export function calculateUSDCost(resolvedModel: string, usage: Usage): number {
  const modelCosts = getModelCosts(resolvedModel, usage)
  return tokensToUSDCost(modelCosts, usage)
}

/**
 * Calculate cost from raw token counts without requiring a full BetaUsage object.
 * Useful for side queries (e.g. classifier) that track token counts independently.
 */
export function calculateCostFromTokens(
  model: string,
  tokens: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
  },
): number {
  const usage: Usage = {
    input_tokens: tokens.inputTokens,
    output_tokens: tokens.outputTokens,
    cache_read_input_tokens: tokens.cacheReadInputTokens,
    cache_creation_input_tokens: tokens.cacheCreationInputTokens,
  } as Usage
  return calculateUSDCost(model, usage)
}

function formatPrice(price: number): string {
  // Format price: integers without decimals, others with 2 decimal places
  // e.g., 3 -> "$3", 0.8 -> "$0.80", 22.5 -> "$22.50"
  if (Number.isInteger(price)) {
    return `$${price}`
  }
  return `$${price.toFixed(2)}`
}

/**
 * Format model costs as a pricing string for display
 * e.g., "$3/$15 per Mtok"
 */
export function formatModelPricing(costs: ModelCosts): string {
  return `${formatPrice(costs.inputTokens)}/${formatPrice(costs.outputTokens)} per Mtok`
}

/**
 * Get formatted pricing string for a model
 * Accepts either a short name or full model name
 * Returns undefined if model is not found
 */
export function getModelPricingString(model: string): string | undefined {
  const shortName = getCanonicalName(model)
  if (
    shortName === firstPartyNameToCanonical(CLAUDE_SONNET_5_CONFIG.firstParty)
  ) {
    return formatModelPricing(COST_TIER_2_10)
  }
  const costs = MODEL_COSTS[shortName]
  if (!costs) return undefined
  return formatModelPricing(costs)
}
