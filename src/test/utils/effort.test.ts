import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getSupportedEffortLevelsForModel,
  parseEffortValue,
  resolveAppliedEffort,
} from '../../utils/effort.js'

const ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'CLAUDE_CODE_ALWAYS_ENABLE_EFFORT',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_VERTEX',
  'USER_TYPE',
] as const

const originalEnv = new Map<string, string | undefined>()

function resetEnv(): void {
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key)
    if (original === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = original
    }
  }
}

describe('effort model support', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    resetEnv()
  })

  test('Opus 4.7 supports all effort levels and defaults to xhigh', () => {
    expect(getSupportedEffortLevelsForModel('claude-opus-4-7')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(resolveAppliedEffort('claude-opus-4-7', undefined)).toBe('xhigh')
  })

  test('Opus 4.6 supports max but clamps xhigh to high', () => {
    expect(getSupportedEffortLevelsForModel('claude-opus-4-6')).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ])
    expect(resolveAppliedEffort('claude-opus-4-6', 'xhigh')).toBe('high')
    expect(resolveAppliedEffort('claude-opus-4-6', 'max')).toBe('max')
  })

  test('Sonnet 4.6 supports base effort levels only; max clamps to high (Opus-tier only)', () => {
    expect(getSupportedEffortLevelsForModel('claude-sonnet-4-6')).toEqual([
      'low',
      'medium',
      'high',
    ])
    expect(resolveAppliedEffort('claude-sonnet-4-6', 'xhigh')).toBe('high')
    expect(resolveAppliedEffort('claude-sonnet-4-6', 'max')).toBe('high')
  })

  test('Opus 4.5 supports base effort levels and clamps higher levels to high', () => {
    expect(getSupportedEffortLevelsForModel('claude-opus-4-5')).toEqual([
      'low',
      'medium',
      'high',
    ])
    expect(resolveAppliedEffort('claude-opus-4-5', 'xhigh')).toBe('high')
    expect(resolveAppliedEffort('claude-opus-4-5', 'max')).toBe('high')
  })

  test('unsupported models do not receive an applied effort', () => {
    expect(getSupportedEffortLevelsForModel('claude-haiku-4-5')).toEqual([])
    expect(getSupportedEffortLevelsForModel('claude-sonnet-4-5')).toEqual([])
    expect(getSupportedEffortLevelsForModel('custom-model')).toEqual([])
    expect(resolveAppliedEffort('claude-haiku-4-5', 'low')).toBeUndefined()
  })

  test('Bedrock supports effort on Opus 4.7/4.8 but not other models', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(getSupportedEffortLevelsForModel('claude-opus-4-7')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(getSupportedEffortLevelsForModel('claude-opus-4-8')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(resolveAppliedEffort('claude-opus-4-7', undefined)).toBe('xhigh')
    // Bedrock-prefixed model strings should canonicalize and still match.
    expect(
      getSupportedEffortLevelsForModel(
        'us.anthropic.claude-opus-4-7-20251101-v1:0',
      ),
    ).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    // Older models on Bedrock still get no effort (mirrors adaptive-thinking allowlist).
    expect(getSupportedEffortLevelsForModel('claude-opus-4-6')).toEqual([])
    expect(getSupportedEffortLevelsForModel('claude-sonnet-4-6')).toEqual([])
  })

  test('third-party Anthropic-compatible models require capability overrides', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.test'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'proxy-opus'

    expect(getSupportedEffortLevelsForModel('proxy-opus')).toEqual([])

    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'effort,max_effort,xhigh_effort'

    expect(getSupportedEffortLevelsForModel('proxy-opus')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  test('OpenAI-compatible provider opt-in exposes low/medium/high/xhigh (no max)', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'

    // Default off — no effort surfaced.
    expect(getSupportedEffortLevelsForModel('gpt-5')).toEqual([])
    expect(resolveAppliedEffort('gpt-5', 'high')).toBeUndefined()

    // Opt-in via env var.
    process.env.CLAUDE_CODE_OPENAI_REASONING_EFFORT = '1'
    expect(getSupportedEffortLevelsForModel('gpt-5')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    // Same shape for Gemini-via-OpenAI-compat and any other model name.
    expect(getSupportedEffortLevelsForModel('gemini-2.5-pro')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    // `max` is Anthropic-only — clampEffortToSupportedLevels picks the highest
    // available level ≤ max, which is xhigh. The shim then emits xhigh verbatim
    // for OpenAI (which supports it). If the proxy doesn't accept xhigh (e.g.
    // Gemini OpenAI-compat), the proxy rejects — user can dial back.
    expect(resolveAppliedEffort('gpt-5', 'max')).toBe('xhigh')
    expect(resolveAppliedEffort('gpt-5', 'xhigh')).toBe('xhigh')
  })

  test('numeric effort values are ant-only', () => {
    expect(parseEffortValue('100')).toBeUndefined()
    expect(resolveAppliedEffort('claude-opus-4-7', 100)).toBeUndefined()

    process.env.USER_TYPE = 'ant'
    expect(parseEffortValue('100')).toBe(100)
    expect(parseEffortValue('100abc')).toBeUndefined()
  })
})
