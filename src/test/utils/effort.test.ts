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

  test('Opus 4.6 and Sonnet 4.6 support max but clamp xhigh to high', () => {
    for (const model of ['claude-opus-4-6', 'claude-sonnet-4-6']) {
      expect(getSupportedEffortLevelsForModel(model)).toEqual([
        'low',
        'medium',
        'high',
        'max',
      ])
      expect(resolveAppliedEffort(model, 'xhigh')).toBe('high')
      expect(resolveAppliedEffort(model, 'max')).toBe('max')
    }
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

  test('numeric effort values are ant-only', () => {
    expect(parseEffortValue('100')).toBeUndefined()
    expect(resolveAppliedEffort('claude-opus-4-7', 100)).toBeUndefined()

    process.env.USER_TYPE = 'ant'
    expect(parseEffortValue('100')).toBe(100)
    expect(parseEffortValue('100abc')).toBeUndefined()
  })
})
