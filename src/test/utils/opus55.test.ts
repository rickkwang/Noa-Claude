import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearBetasCaches,
  modelEnforcesThinkingPrefixBinding,
  modelRejectsForcedToolChoice,
  modelSupportsStructuredOutputs,
} from '../../utils/betas.js'
import { getModelMaxOutputTokens } from '../../utils/context.js'
import {
  getApiDefaultEffortForModel,
  getDefaultEffortForModel,
  getSupportedEffortLevelsForModel,
} from '../../utils/effort.js'
import { isFastModeSupportedByModel } from '../../utils/fastMode.js'
import { hasNative1mContext } from '../../utils/model/native1m.js'
import {
  firstPartyNameToCanonical,
  getMarketingNameForModel,
} from '../../utils/model/model.js'
import { getModelFallbackSuggestionForTesting } from '../../utils/model/validateModel.js'
import { getModelCosts } from '../../utils/modelCost.js'
import { getBuiltInPromptCapabilities } from '../../constants/systemPromptCompact.js'
import { getVertexRegionForModel } from '../../utils/envUtils.js'
import {
  modelRequiresExplicitThinkingDisable,
  modelSupportsAdaptiveThinking,
  modelThinkingCannotBeDisabled,
} from '../../utils/thinking.js'

const SAVED = { ...process.env }

beforeEach(() => {
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
})

afterEach(() => {
  process.env = { ...SAVED }
  clearBetasCaches()
})

const OPUS_55 = 'claude-opus-5-5'

describe('Opus 5.5 identity', () => {
  test("canonicalizes separately from Opus 5 ('claude-opus-5' is a prefix)", () => {
    expect(firstPartyNameToCanonical(OPUS_55)).toBe(OPUS_55)
    expect(firstPartyNameToCanonical('us.anthropic.claude-opus-5-5')).toBe(
      OPUS_55,
    )
    expect(firstPartyNameToCanonical('claude-opus-5')).toBe('claude-opus-5')
  })

  test('has its own marketing name', () => {
    expect(getMarketingNameForModel(OPUS_55)).toBe('Opus 5.5')
    expect(getMarketingNameForModel('claude-opus-5')).toBe('Opus 5')
  })
})

describe('Opus 5.5 request surface', () => {
  test('thinking cannot be disabled, and is never sent as disabled', () => {
    expect(modelThinkingCannotBeDisabled(OPUS_55)).toBe(true)
    expect(modelRequiresExplicitThinkingDisable(OPUS_55)).toBe(false)
    // Opus 5 keeps its explicit-disable path.
    expect(modelRequiresExplicitThinkingDisable('claude-opus-5')).toBe(true)
    expect(modelSupportsAdaptiveThinking(OPUS_55)).toBe(true)
  })

  test('rejects forced tool_choice and binds thinking to the prefix', () => {
    expect(modelRejectsForcedToolChoice(OPUS_55)).toBe(true)
    expect(modelEnforcesThinkingPrefixBinding(OPUS_55)).toBe(true)
    expect(modelRejectsForcedToolChoice('claude-opus-5')).toBe(false)
    expect(modelEnforcesThinkingPrefixBinding('claude-opus-5')).toBe(false)
  })

  test('full effort ladder; API default is medium, not high', () => {
    expect(getSupportedEffortLevelsForModel(OPUS_55)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(getDefaultEffortForModel(OPUS_55)).toBeUndefined()
    expect(getApiDefaultEffortForModel(OPUS_55)).toBe('medium')
    expect(getApiDefaultEffortForModel('claude-opus-5')).toBe('high')
  })

  test('128K output by default, native 1M, structured outputs, fast mode', () => {
    expect(getModelMaxOutputTokens(OPUS_55)).toEqual({
      default: 128_000,
      upperLimit: 128_000,
    })
    expect(hasNative1mContext(OPUS_55)).toBe(true)
    expect(modelSupportsStructuredOutputs(OPUS_55)).toBe(true)
    expect(isFastModeSupportedByModel(OPUS_55)).toBe(true)
  })

  test('lean prompt head without Opus 5 or Fable bundles', () => {
    expect(getBuiltInPromptCapabilities(OPUS_55)).toEqual({
      leanPrompt: true,
      opus5PromptBundle: false,
      fable5Mitigations: false,
      fable51PromptBundle: false,
    })
  })
})

describe('Opus 5.5 pricing', () => {
  test('$4/$20 with $0.20 cache reads', () => {
    const costs = getModelCosts(OPUS_55, {
      input_tokens: 0,
      output_tokens: 0,
    } as never)
    expect(costs.inputTokens).toBe(4)
    expect(costs.outputTokens).toBe(20)
    expect(costs.promptCacheWriteTokens).toBe(5)
    expect(costs.promptCacheReadTokens).toBe(0.2)
  })
})

describe('Opus 5.5 third-party routing', () => {
  test('falls back to Opus 5, and Fable 5 falls back to Opus 5.5', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(getModelFallbackSuggestionForTesting(OPUS_55)).toContain(
      'claude-opus-5',
    )
    expect(getModelFallbackSuggestionForTesting(OPUS_55)).not.toContain(
      'claude-opus-5-5',
    )
    expect(getModelFallbackSuggestionForTesting('claude-fable-5')).toContain(
      'claude-opus-5-5',
    )
  })

  test('Vertex region override uses the per-generation variable', () => {
    process.env.CLOUD_ML_REGION = 'us-east5'
    process.env.VERTEX_REGION_CLAUDE_5_5_OPUS = 'europe-west1'
    process.env.VERTEX_REGION_CLAUDE_4_0_OPUS = 'asia-east1'
    expect(getVertexRegionForModel(OPUS_55)).toBe('europe-west1')
    // Opus 4.8 must not fall through to the Opus 4.0 variable.
    expect(getVertexRegionForModel('claude-opus-4-8')).toBe('us-east5')
  })
})
