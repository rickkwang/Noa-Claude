import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearBetasCaches,
  modelSupportsWebSearchDynamicFiltering,
} from '../../utils/betas.js'

const ENV_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
] as const

const original = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
  clearBetasCaches()
})

/**
 * The predicate only selects between two tool `type` literals that are
 * otherwise field-identical. Over-declaring is the failure that matters: an
 * unknown tool type is a hard 400, while under-declaring just forgoes dynamic
 * filtering — so the negative cases below are the load-bearing ones.
 */
describe('modelSupportsWebSearchDynamicFiltering', () => {
  test('direct first-party takes the dynamic-filtering variant on documented models', () => {
    delete process.env.ANTHROPIC_BASE_URL
    for (const model of [
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-opus-5',
      'claude-sonnet-4-6',
      'claude-sonnet-5',
    ]) {
      expect(modelSupportsWebSearchDynamicFiltering(model)).toBe(true)
    }
  })

  test('older models stay on the basic variant', () => {
    delete process.env.ANTHROPIC_BASE_URL
    for (const model of [
      'claude-haiku-4-5',
      'claude-sonnet-4-5',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-3-5-sonnet-20241022',
    ]) {
      expect(modelSupportsWebSearchDynamicFiltering(model)).toBe(false)
    }
  })

  test('Fable 5 and Mythos 5 stay on the basic variant until documented', () => {
    delete process.env.ANTHROPIC_BASE_URL
    expect(modelSupportsWebSearchDynamicFiltering('claude-fable-5')).toBe(false)
    expect(modelSupportsWebSearchDynamicFiltering('claude-mythos-5')).toBe(false)
  })

  test('Vertex serves only the basic variant, even on a supported model', () => {
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    clearBetasCaches()
    expect(modelSupportsWebSearchDynamicFiltering('claude-opus-5')).toBe(false)
  })

  test('Bedrock stays on the basic variant', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    clearBetasCaches()
    expect(modelSupportsWebSearchDynamicFiltering('claude-opus-5')).toBe(false)
  })

  test('a 3P Anthropic-compatible endpoint stays on the basic variant', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.kimi.com/coding'
    clearBetasCaches()
    expect(modelSupportsWebSearchDynamicFiltering('claude-opus-5')).toBe(false)
    expect(modelSupportsWebSearchDynamicFiltering('k3-256k')).toBe(false)
  })
})
