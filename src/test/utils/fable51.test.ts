import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearBetasCaches,
  modelEnforcesThinkingPrefixBinding,
  modelRejectsForcedToolChoice,
  shouldSendThinkingBindingControls,
} from '../../utils/betas.js'
import { findFirstMatch } from '../../utils/model/bedrock.js'
import { hasNative1mContext } from '../../utils/model/native1m.js'
import {
  firstPartyNameToCanonical,
  getMarketingNameForModel,
} from '../../utils/model/model.js'
import { getModelMaxOutputTokens } from '../../utils/context.js'
import { getModelCosts } from '../../utils/modelCost.js'
import {
  modelSupportsAdaptiveThinking,
  modelOmitsThinkingByDefault,
  modelRequiresExplicitThinkingDisable,
} from '../../utils/thinking.js'
import { getDefaultEffortForModel, getSupportedEffortLevelsForModel } from '../../utils/effort.js'
import { isFastModeSupportedByModel } from '../../utils/fastMode.js'

const SAVED = { ...process.env }

beforeEach(() => {
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.ANTHROPIC_BASE_URL
})

afterEach(() => {
  process.env = { ...SAVED }
  clearBetasCaches()
})

describe('Fable 5.1 identity', () => {
  test('canonicalizes separately from Fable 5', () => {
    expect(firstPartyNameToCanonical('claude-fable-5-1')).toBe(
      'claude-fable-5-1',
    )
    expect(firstPartyNameToCanonical('claude-fable-5')).toBe('claude-fable-5')
    expect(firstPartyNameToCanonical('us.anthropic.claude-fable-5-1')).toBe(
      'claude-fable-5-1',
    )
    expect(firstPartyNameToCanonical('claude-mythos-5-1')).toBe(
      'claude-mythos-5-1',
    )
  })

  test('renders its own marketing name', () => {
    expect(getMarketingNameForModel('claude-fable-5-1')).toBe('Fable 5.1')
    // Marketing names never carry the inert [1m] marker.
    expect(getMarketingNameForModel('claude-fable-5-1[1m]')).toBe('Fable 5.1')
    expect(getMarketingNameForModel('claude-fable-5')).toBe('Fable 5')
  })

  test('serves 1M context natively on first party', () => {
    expect(hasNative1mContext('claude-fable-5-1')).toBe(true)
  })
})

describe('Fable 5.1 request surface', () => {
  test('rejects forced tool_choice, unlike Fable 5', () => {
    expect(modelRejectsForcedToolChoice('claude-fable-5-1')).toBe(true)
    expect(modelRejectsForcedToolChoice('claude-mythos-5-1')).toBe(true)
    expect(modelRejectsForcedToolChoice('claude-fable-5')).toBe(false)
    expect(modelRejectsForcedToolChoice('claude-opus-5')).toBe(false)
  })

  test('inherits the Fable thinking surface', () => {
    expect(modelSupportsAdaptiveThinking('claude-fable-5-1')).toBe(true)
    expect(modelOmitsThinkingByDefault('claude-fable-5-1')).toBe(true)
    // Thinking is always on: the request omits `thinking` rather than sending
    // an explicit {type:'disabled'}, which the API rejects with a 400.
    expect(modelRequiresExplicitThinkingDisable('claude-fable-5-1')).toBe(false)
  })

  test('offers the full effort range', () => {
    expect(getSupportedEffortLevelsForModel('claude-fable-5-1')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  test('has no fast mode', () => {
    expect(isFastModeSupportedByModel('claude-fable-5-1')).toBe(false)
  })
})

describe('Fable 5.1 pricing', () => {
  test('same $10/$50 as Fable 5 but cheaper cache reads', () => {
    const usage = { input_tokens: 0, output_tokens: 0 } as Parameters<
      typeof getModelCosts
    >[1]
    const fable51 = getModelCosts('claude-fable-5-1', usage)
    const fable5 = getModelCosts('claude-fable-5', usage)
    expect(fable51.inputTokens).toBe(10)
    expect(fable51.outputTokens).toBe(50)
    expect(fable51.promptCacheReadTokens).toBe(0.25)
    expect(fable5.promptCacheReadTokens).toBe(1)
  })
})

describe('Fable 5.2', () => {
  test('is its own model, separate from 5.1 and 5', () => {
    expect(firstPartyNameToCanonical('claude-fable-5-2')).toBe('claude-fable-5-2')
    expect(firstPartyNameToCanonical('claude-mythos-5-2')).toBe('claude-mythos-5-2')
    expect(getMarketingNameForModel('claude-fable-5-2')).toBe('Fable 5.2')
    expect(hasNative1mContext('claude-fable-5-2')).toBe(true)
  })

  test('shares the 5.1 request surface', () => {
    expect(modelRejectsForcedToolChoice('claude-fable-5-2')).toBe(true)
    expect(modelEnforcesThinkingPrefixBinding('claude-fable-5-2')).toBe(true)
    expect(modelRequiresExplicitThinkingDisable('claude-fable-5-2')).toBe(false)
    expect(getSupportedEffortLevelsForModel('claude-fable-5-2')).toContain('xhigh')
  })

  test('defaults to medium effort, unlike Fable 5.1', () => {
    expect(getDefaultEffortForModel('claude-fable-5-2')).toBe('medium')
    expect(getDefaultEffortForModel('claude-fable-5-1')).toBe('high')
  })

  test('Mythos 5.2 enforces the history-editing check too, unlike Mythos 5.1', () => {
    expect(modelEnforcesThinkingPrefixBinding('claude-mythos-5-2')).toBe(true)
    expect(modelEnforcesThinkingPrefixBinding('claude-mythos-5-1')).toBe(false)
  })

  test('defaults max output to the 128K ceiling, unlike Fable 5.1', () => {
    expect(getModelMaxOutputTokens('claude-fable-5-2')).toEqual({ default: 128_000, upperLimit: 128_000 })
    expect(getModelMaxOutputTokens('claude-mythos-5-2').default).toBe(128_000)
    expect(getModelMaxOutputTokens('claude-fable-5-1').default).toBe(64_000)
  })

  test('costs $8/$40 with $0.20 cache reads', () => {
    const usage = { input_tokens: 0, output_tokens: 0 } as Parameters<
      typeof getModelCosts
    >[1]
    const costs = getModelCosts('claude-fable-5-2', usage)
    expect(costs.inputTokens).toBe(8)
    expect(costs.outputTokens).toBe(40)
    expect(costs.promptCacheReadTokens).toBe(0.2)
  })

  test('supports fast mode, priced at $16/$80', () => {
    expect(isFastModeSupportedByModel('claude-fable-5-2')).toBe(true)
    expect(isFastModeSupportedByModel('claude-fable-5-1')).toBe(false)
    const usage = { input_tokens: 0, output_tokens: 0, speed: 'fast' } as Parameters<
      typeof getModelCosts
    >[1]
    const fast = getModelCosts('claude-fable-5-2', usage)
    expect(fast.inputTokens).toBe(16)
    expect(fast.outputTokens).toBe(80)
  })
})

describe('Bedrock inference profile matching', () => {
  test('a 5.1 profile does not satisfy the Fable 5 needle', () => {
    const profiles = [
      'us.anthropic.claude-fable-5-1',
      'us.anthropic.claude-fable-5',
    ]
    expect(findFirstMatch(profiles, 'claude-fable-5')).toBe(
      'us.anthropic.claude-fable-5',
    )
    expect(findFirstMatch(profiles, 'claude-fable-5-1')).toBe(
      'us.anthropic.claude-fable-5-1',
    )
  })

  test('falls back to any substring match when no exact generation exists', () => {
    expect(
      findFirstMatch(['us.anthropic.claude-fable-5-1'], 'claude-fable-5'),
    ).toBe('us.anthropic.claude-fable-5-1')
  })
})

describe('preserved thinking (prefix binding)', () => {
  test('Fable 5.1 binds thinking blocks to the prefix; Mythos 5.1 does not', () => {
    expect(modelEnforcesThinkingPrefixBinding('claude-fable-5-1')).toBe(true)
    expect(modelEnforcesThinkingPrefixBinding('claude-mythos-5-1')).toBe(false)
    expect(modelEnforcesThinkingPrefixBinding('claude-fable-5')).toBe(false)
    expect(modelEnforcesThinkingPrefixBinding('claude-opus-5')).toBe(false)
    expect(modelEnforcesThinkingPrefixBinding('claude-opus-4-8')).toBe(false)
  })

  test('canonicalizes provider-prefixed ids', () => {
    expect(
      modelEnforcesThinkingPrefixBinding('us.anthropic.claude-fable-5-1'),
    ).toBe(true)
  })

  test('the controls beta is direct-firstParty only', () => {
    expect(shouldSendThinkingBindingControls('claude-fable-5-1')).toBe(true)

    // Foundry offers no binding controls, unlike other experimental betas.
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    expect(shouldSendThinkingBindingControls('claude-fable-5-1')).toBe(false)
    delete process.env.CLAUDE_CODE_USE_FOUNDRY

    // Bedrock/Vertex reject the header until the per-model rollout lands.
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(shouldSendThinkingBindingControls('claude-fable-5-1')).toBe(false)
    delete process.env.CLAUDE_CODE_USE_BEDROCK

    // A custom base URL reports firstParty but is a proxy.
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.com'
    expect(shouldSendThinkingBindingControls('claude-fable-5-1')).toBe(false)
  })

  test('models that do not enforce the check never send the beta', () => {
    expect(shouldSendThinkingBindingControls('claude-opus-5')).toBe(false)
    expect(shouldSendThinkingBindingControls('claude-fable-5')).toBe(false)
  })
})
