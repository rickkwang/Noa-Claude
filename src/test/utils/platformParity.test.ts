import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearBetasCaches,
  cloudProviderSupportsEagerInputStreaming,
  modelSupportsWebSearchDynamicFiltering,
} from '../../utils/betas.js'
import { getSupportedEffortLevelsForModel } from '../../utils/effort.js'
import { getModelDeprecationWarning } from '../../utils/model/deprecation.js'
import {
  modelSupportsAdaptiveThinking,
  modelSupportsThinking,
} from '../../utils/thinking.js'

const SAVED = { ...process.env }

beforeEach(() => {
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.ANTHROPIC_BEDROCK_BASE_URL
  delete process.env.ANTHROPIC_VERTEX_BASE_URL
})

afterEach(() => {
  process.env = { ...SAVED }
  clearBetasCaches()
})

describe('adaptive thinking is chosen by model, not platform', () => {
  test('Vertex and Bedrock never get budget_tokens for adaptive-only models', () => {
    for (const env of ['CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_BEDROCK']) {
      process.env.CLAUDE_CODE_USE_VERTEX = ''
      process.env.CLAUDE_CODE_USE_BEDROCK = ''
      process.env[env] = '1'
      for (const model of [
        'claude-opus-4-7',
        'claude-opus-4-8',
        'claude-opus-5',
        'claude-opus-5-5',
        'claude-sonnet-5',
        'claude-sonnet-4-6',
      ]) {
        expect(modelSupportsAdaptiveThinking(model)).toBe(true)
      }
      expect(modelSupportsAdaptiveThinking('claude-haiku-4-5')).toBe(false)
    }
  })

  test('Fable on a cloud provider still gets a thinking param', () => {
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    expect(modelSupportsThinking('claude-fable-5-1')).toBe(true)
    expect(modelSupportsThinking('claude-3-7-sonnet-20250219')).toBe(false)
  })
})

describe('server-tool and per-tool field gating', () => {
  test('dynamic-filtering web search is first-party only', () => {
    expect(modelSupportsWebSearchDynamicFiltering('claude-opus-5')).toBe(true)
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    expect(modelSupportsWebSearchDynamicFiltering('claude-opus-5')).toBe(false)
  })

  test('eager_input_streaming follows the catalog per provider', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(cloudProviderSupportsEagerInputStreaming('claude-opus-4-8')).toBe(true)
    // Older Bedrock serving stack 400s on the field.
    expect(cloudProviderSupportsEagerInputStreaming('claude-opus-4-6')).toBe(false)
    process.env.ANTHROPIC_BEDROCK_BASE_URL = 'https://proxy.example.test'
    expect(cloudProviderSupportsEagerInputStreaming('claude-opus-4-8')).toBe(false)

    process.env.CLAUDE_CODE_USE_BEDROCK = ''
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    expect(cloudProviderSupportsEagerInputStreaming('claude-opus-4-6')).toBe(true)
    expect(cloudProviderSupportsEagerInputStreaming('claude-haiku-4-5')).toBe(false)
  })
})

describe('effort on cloud providers', () => {
  test('GA models get their ladder; Opus 4.5 (beta-era effort) stays off', () => {
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    expect(getSupportedEffortLevelsForModel('claude-opus-4-6')).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ])
    expect(getSupportedEffortLevelsForModel('claude-opus-4-5-20251101')).toEqual(
      [],
    )
    process.env.CLAUDE_CODE_USE_VERTEX = ''
    expect(getSupportedEffortLevelsForModel('claude-opus-4-5-20251101')).toEqual(
      ['low', 'medium', 'high'],
    )
  })
})

describe('deprecation table', () => {
  test('Opus 4 and Sonnet 4 carry retirement dates, past dates read as retired', () => {
    expect(getModelDeprecationWarning('claude-opus-4-20250514')).toContain(
      'Claude Opus 4 was retired on June 15, 2026',
    )
    expect(getModelDeprecationWarning('claude-sonnet-4-20250514')).toContain(
      'Claude Sonnet 4',
    )
    expect(getModelDeprecationWarning('claude-sonnet-4-5-20250929')).toBeNull()
    expect(getModelDeprecationWarning('claude-opus-4-8')).toBeNull()
  })
})
