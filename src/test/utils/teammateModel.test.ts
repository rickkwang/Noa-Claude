import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getMainLoopModelOverride,
  setMainLoopModelOverride,
} from '../../bootstrap/state.js'
import { getDefaultOpusModel } from '../../utils/model/model.js'
import { getDefaultTeammateModelFallback } from '../../utils/swarm/teammateModel.js'

const ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_OPENAI',
] as const
const original = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))
const originalMainLoopModel = getMainLoopModelOverride()

beforeEach(() => {
  // No test drives ANTHROPIC_MODEL, but getMainLoopModel() prefers it over
  // the main-loop override — an ambient value (e.g. from an active provider
  // profile) would silently win instead of the override the tests set.
  delete process.env.ANTHROPIC_MODEL
  // Same for ANTHROPIC_DEFAULT_OPUS_MODEL: getDefaultTeammateModelFallback
  // checks it before any provider branch. Tests that drive it set it
  // explicitly below.
  delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
})

afterEach(() => {
  setMainLoopModelOverride(originalMainLoopModel)
  for (const key of ENV_KEYS) {
    const value = original[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('teammate model fallback', () => {
  test('follows the provider-aware main-loop Opus default', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL

    expect(getDefaultTeammateModelFallback()).toBe(getDefaultOpusModel())
    expect(getDefaultTeammateModelFallback()).toContain('opus-4-8')
  })

  test('honors an explicit provider model override', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'custom-opus-model'

    expect(getDefaultTeammateModelFallback()).toBe('custom-opus-model')
  })

  test('inherits the main model on OpenAI-compatible providers', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    setMainLoopModelOverride('gpt-5.1')

    expect(getDefaultTeammateModelFallback()).toBe('gpt-5.1')
  })

  test('inherits the main model on custom Anthropic-compatible endpoints', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://example.test/anthropic'
    setMainLoopModelOverride('custom-provider-model')

    expect(getDefaultTeammateModelFallback()).toBe('custom-provider-model')
  })
})
